//! §B3 #2 activate_tier, #3 upgrade_tier, #5 claim_yield (+ #8 void_tier internal path).
//!
//! Weight model: `Config.total_weight_bp` is the running Σw of live tiers and is
//! snapshotted into `Epoch` at finalize. Each finalize adds `distributable × ACC_SCALE / Σw`
//! to `Config.acc_per_weight`; a tier's stamp is the counter value at activation / last
//! claim, so `(acc − stamp) × w` is exactly its share of every round it was in (OTC
//! "counter minus stamp"). Upgrades require the pending share to be settled first, so the
//! weight used to price a round is always the weight that was in that round's Σw.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::require_desk;
use crate::instructions::otc_pay::{burn_checked, require_token_account, transfer_checked};
use crate::instructions::pot::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ActivateTier<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner + collection verified in `require_desk`.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: matched against config.ops_wallet.
    #[account(mut, address = config.ops_wallet @ HubError::Unauthorized)]
    pub ops_wallet: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler); burned on activation.
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `burn_checked`/`transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = payer, space = 8 + DeskTier::INIT_SPACE,
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump
    )]
    pub desk_tier: Account<'info, DeskTier>,
    /// Ascending per-tier SOL fee (§A4, revised) — see `TierFeeConfig`.
    #[account(seeds = [SEED_TIER_FEE], bump = tier_fee.bump)]
    pub tier_fee: Account<'info, TierFeeConfig>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    /// CHECK: recorded on TokenomicsConfig at init; holds the genesis floor + reward deposits —
    /// the 50%-of-cost "reward" leg of the tier-activation burn split lands here (see
    /// `Config.tier_cost_burn_bp`), same destination `fund_treasury_reward` uses.
    #[account(mut, address = tokenomics.treasury_lock_vault @ HubError::InvalidTokenAccount)]
    pub treasury_lock_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Fresh activation into any tier `target_tier`, or re-activation of a voided tier (full price,
/// §B5 wash-transfer): flat, tier-indexed `tier_fee.step_fee(0, target_tier)` SOL (90% pot / 10%
/// ops — T1 0.2 / T2 0.3 / T3 0.4 / T4 0.5 SOL) + the full $HUB
/// cost of `target_tier`, split `tier_cost_burn_bp` burned / remainder into the active-desk
/// reward pool (`TokenomicsConfig.reward_pending_units`, same mechanism `fund_treasury_reward`
/// feeds — paid out pro-rata by `distribute_treasury_reward` the next round it opens).
pub fn activate_tier(ctx: Context<ActivateTier>, target_tier: u8) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.payer.key(),
        HubError::NotDeskOwner
    );

    let t = &mut ctx.accounts.desk_tier;
    require_activatable(t)?;

    let config = &mut ctx.accounts.config;
    require_token_account(
        &ctx.accounts.payer_hub,
        &config.hub_mint,
        ctx.accounts.payer.key,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let fee = ctx.accounts.tier_fee.step_fee(0, target_tier)?;
    let hub_cost = config.hub_cost_delta(0, target_tier, now)?;
    let hub_burn = bps_of(hub_cost, config.tier_cost_burn_bp)?;
    let hub_reward = sub(hub_cost, hub_burn)?;
    let to_ops = bps_of(fee, config.ops_pct_bp)?;
    let to_pot = sub(fee, to_ops)?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.pot,
        to_pot,
    )?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.ops_wallet,
        to_ops,
    )?;
    book_inflow(config, &mut ctx.accounts.epoch, to_pot)?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_burn,
        &[],
    )?;
    if hub_reward > 0 {
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.payer_hub,
            &ctx.accounts.hub_mint,
            &ctx.accounts.treasury_lock_vault,
            &ctx.accounts.payer,
            hub_reward,
            &[],
        )?;
        let tk = &mut ctx.accounts.tokenomics;
        tk.reward_pending_units = add(tk.reward_pending_units, hub_reward)?;
        tk.reward_deposited_units = add(tk.reward_deposited_units, hub_reward)?;
    }

    let epoch_idx = apply_activation(
        config,
        t,
        ctx.accounts.desk_asset.key(),
        asset.owner,
        target_tier,
        ctx.bumps.desk_tier,
    )?;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(TierActivated {
        asset: t.asset_id,
        owner: asset.owner,
        tier: target_tier,
        epoch: epoch_idx,
        fee_lamports: fee,
        to_pot,
        to_ops,
        hub_burned_units: hub_burn,
        hub_reward_units: hub_reward,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpgradeTier<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership re-verified here (lazy revocation).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: matched against config.ops_wallet.
    #[account(mut, address = config.ops_wallet @ HubError::Unauthorized)]
    pub ops_wallet: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler); burned on upgrade.
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `burn_checked`/`transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    #[account(
        mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided @ HubError::TierVoided
    )]
    pub desk_tier: Account<'info, DeskTier>,
    /// Ascending per-tier SOL fee (§A4, revised) — see `TierFeeConfig`.
    #[account(seeds = [SEED_TIER_FEE], bump = tier_fee.bump)]
    pub tier_fee: Account<'info, TierFeeConfig>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    /// CHECK: recorded on TokenomicsConfig at init; holds the genesis floor + reward deposits —
    /// the 50%-of-cost "reward" leg of the tier-upgrade burn split lands here (see
    /// `Config.tier_cost_burn_bp`), same destination `fund_treasury_reward` uses.
    #[account(mut, address = tokenomics.treasury_lock_vault @ HubError::InvalidTokenAccount)]
    pub treasury_lock_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Pay `tier_fee.step_fee` once, indexed by the target tier reached (never the step size, §A4
/// revised — 90% pot / 10% ops) + the $HUB cost difference for `from → target_tier`, split
/// `tier_cost_burn_bp` burned / remainder into the active-desk reward pool (see `activate_tier`'s
/// doc comment). Ownership change → void, no charge.
pub fn upgrade_tier(ctx: Context<UpgradeTier>, target_tier: u8) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    let config = &mut ctx.accounts.config;
    let t = &mut ctx.accounts.desk_tier;

    if asset.owner != t.owner_at_activation {
        return void_tier(config, t, asset.owner);
    }
    require_keys_eq!(
        asset.owner,
        ctx.accounts.payer.key(),
        HubError::NotDeskOwner
    );
    require_token_account(
        &ctx.accounts.payer_hub,
        &config.hub_mint,
        ctx.accounts.payer.key,
    )?;
    let from = settle_for_upgrade(config, t)?;

    let now = Clock::get()?.unix_timestamp;
    let fee = ctx.accounts.tier_fee.step_fee(from, target_tier)?;
    let hub_cost = config.hub_cost_delta(from, target_tier, now)?;
    let hub_burn = bps_of(hub_cost, config.tier_cost_burn_bp)?;
    let hub_reward = sub(hub_cost, hub_burn)?;
    let to_ops = bps_of(fee, config.ops_pct_bp)?;
    let to_pot = sub(fee, to_ops)?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.pot,
        to_pot,
    )?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.ops_wallet,
        to_ops,
    )?;
    book_inflow(config, &mut ctx.accounts.epoch, to_pot)?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_burn,
        &[],
    )?;
    if hub_reward > 0 {
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.payer_hub,
            &ctx.accounts.hub_mint,
            &ctx.accounts.treasury_lock_vault,
            &ctx.accounts.payer,
            hub_reward,
            &[],
        )?;
        let tk = &mut ctx.accounts.tokenomics;
        tk.reward_pending_units = add(tk.reward_pending_units, hub_reward)?;
        tk.reward_deposited_units = add(tk.reward_deposited_units, hub_reward)?;
    }

    apply_upgrade(config, t, target_tier)?;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(TierUpgraded {
        asset: t.asset_id,
        owner: asset.owner,
        from_tier: from,
        to_tier: target_tier,
        epoch: config.current_epoch,
        fee_lamports: fee,
        hub_burned_units: hub_burn,
        hub_reward_units: hub_reward,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimYield<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership re-verified NOW (§B3 #5).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided @ HubError::TierVoided
    )]
    pub desk_tier: Account<'info, DeskTier>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: OTC vault recorded on OtcPotState; the $OTC inventory this instruction pays from.
    #[account(mut, address = otc_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: claimer's $OTC token account (mint/owner verified in handler).
    #[account(mut)]
    pub claimer_otc: UncheckedAccount<'info>,
    /// CHECK: $OTC's token program — Token-2022, asserted in `transfer_checked` against
    /// `otc_mint`'s actual owner.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// One transaction settles every round closed since the tier's stamp:
/// `owed = ⌊(acc − stamp) × w / ACC_SCALE⌋` lamport-equivalent, the sub-lamport remainder goes
/// to dust. §A5: paid in $OTC from `otc_vault`, priced at the pot's lifetime average buy rate
/// (`otc_pot.total_otc_bought_units / total_lamports_spent`) — reverts with
/// `NoOtcPurchased` if the keeper hasn't funded the vault yet, or on-chain (insufficient vault
/// balance) if it hasn't caught up to this claim's share; both are safe to retry later.
///
/// Lazy revocation: if the desk changed hands since activation the tier is voided
/// (persisted, no refund, no payout) and the call returns Ok so the void sticks.
pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    let config = &mut ctx.accounts.config;
    let t = &mut ctx.accounts.desk_tier;

    if asset.owner != t.owner_at_activation {
        return void_tier(config, t, asset.owner);
    }
    require_keys_eq!(
        asset.owner,
        ctx.accounts.claimer.key(),
        HubError::NotDeskOwner
    );

    let w = config.weight_bp(t.tier)?;
    let (owed, frac) = pending_yield(config.acc_per_weight, t.stamp_acc_per_weight, w)?;
    require!(owed > 0, HubError::NothingToClaim);

    let otc_pot = &ctx.accounts.otc_pot;
    require!(otc_pot.total_lamports_spent > 0, HubError::NoOtcPurchased);
    require_token_account(
        &ctx.accounts.claimer_otc,
        &config.otc_mint,
        ctx.accounts.claimer.key,
    )?;
    let otc_due = (owed as u128)
        .checked_mul(otc_pot.total_otc_bought_units as u128)
        .ok_or_else(|| error!(HubError::MathOverflow))?
        / otc_pot.total_lamports_spent as u128;
    let otc_due = u64::try_from(otc_due).map_err(|_| error!(HubError::MathOverflow))?;
    require!(otc_due > 0, HubError::NothingToClaim);

    t.stamp_acc_per_weight = config.acc_per_weight;
    t.total_claimed_lamports = add(t.total_claimed_lamports, owed)?;
    add_dust(config, frac)?;
    // NOTE: unlike the pre-§A5 SOL payout, `owed`'s SOL-equivalent liability was already
    // retired in bulk by `record_otc_buy` (which subtracts the epoch's whole `credited` —
    // i.e. Σ owed — from `pot_liability_lamports` when the keeper is reimbursed for the $OTC
    // buy). Subtracting `owed` again here would double-decrement the same liability and
    // eventually underflow `pot_liability_lamports`. This claim only moves $OTC out of
    // `otc_vault`, which never touches the pot's lamport balance.

    let pot_bump = config.pot_bump;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.otc_vault,
        &ctx.accounts.otc_mint,
        &ctx.accounts.claimer_otc,
        &ctx.accounts.pot,
        otc_due,
        &[&[SEED_POT, &[pot_bump]]],
    )?;
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(YieldClaimed {
        asset: t.asset_id,
        claimer: ctx.accounts.claimer.key(),
        epoch: config.current_epoch,
        tier: t.tier,
        lamports: owed,
        otc_paid: otc_due,
        acc_per_weight: config.acc_per_weight,
    });
    Ok(())
}

/// Fresh activation or re-activation of a voided tier only; an active tier must `upgrade_tier`.
pub(crate) fn require_activatable(t: &DeskTier) -> Result<()> {
    require!(t.tier == 0 || t.voided, HubError::TierAlreadyActive);
    Ok(())
}

/// Tier-state side of activation (shared by the SOL and $OTC payment paths): stamp the
/// accumulator, enter `target_tier` and add its weight to Σw. Returns the activation epoch.
pub(crate) fn apply_activation(
    config: &mut Config,
    t: &mut DeskTier,
    asset_id: Pubkey,
    owner: Pubkey,
    target_tier: u8,
    bump: u8,
) -> Result<u64> {
    let epoch_idx = config.current_epoch;
    t.asset_id = asset_id;
    t.owner_at_activation = owner;
    t.tier = target_tier;
    t.activated_epoch = epoch_idx;
    t.stamp_acc_per_weight = config.acc_per_weight;
    t.total_claimed_lamports = 0;
    t.voided = false;
    t.bump = bump;
    config.total_weight_bp = add(config.total_weight_bp, config.weight_bp(target_tier)?)?;
    Ok(epoch_idx)
}

/// Pre-upgrade gate shared by both payment paths. Pending rounds must be settled at the old
/// weight; a sub-lamport remainder is not claimable, so it is moved to dust here and the stamp
/// advanced. Returns the current tier.
pub(crate) fn settle_for_upgrade(config: &mut Config, t: &mut DeskTier) -> Result<u8> {
    require!(t.tier < TIER_COUNT as u8, HubError::TierMaxed);
    let (owed, frac) = pending_yield(
        config.acc_per_weight,
        t.stamp_acc_per_weight,
        config.weight_bp(t.tier)?,
    )?;
    require!(owed == 0, HubError::ClaimBeforeUpgrade);
    add_dust(config, frac)?;
    t.stamp_acc_per_weight = config.acc_per_weight;
    Ok(t.tier)
}

/// Tier-state side of an upgrade: move Σw by the weight delta and set the new tier.
pub(crate) fn apply_upgrade(config: &mut Config, t: &mut DeskTier, target_tier: u8) -> Result<()> {
    let delta = sub(config.weight_bp(target_tier)?, config.weight_bp(t.tier)?)?;
    config.total_weight_bp = add(config.total_weight_bp, delta)?;
    t.tier = target_tier;
    Ok(())
}

/// §B3 #8 — internal path used by upgrade/claim when ownership changed. The tier's
/// unclaimed share is forfeited to dust (re-enters the pot at the next finalize).
pub(crate) fn void_tier(
    config: &mut Config,
    t: &mut DeskTier,
    current_owner: Pubkey,
) -> Result<()> {
    let w = config.weight_bp(t.tier)?;
    let (forfeited, frac) = pending_yield(config.acc_per_weight, t.stamp_acc_per_weight, w)?;
    add_dust(config, (forfeited as u128) * ACC_SCALE + frac)?;
    t.stamp_acc_per_weight = config.acc_per_weight;
    config.total_weight_bp = sub(config.total_weight_bp, w)?;
    t.voided = true;
    emit!(TierVoided {
        asset: t.asset_id,
        owner_at_activation: t.owner_at_activation,
        current_owner,
        tier: t.tier,
        epoch: config.current_epoch,
        forfeited_lamports: forfeited,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitTierFeeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = 8 + TierFeeConfig::INIT_SPACE, seeds = [SEED_TIER_FEE], bump)]
    pub tier_fee: Account<'info, TierFeeConfig>,
    pub system_program: Program<'info, System>,
}

/// Creates the ascending per-tier SOL fee PDA (one-time, post-`initialize_config`), seeded from
/// `TIER_STEP_FEE_LAMPORTS` (T1 0.2 / T2 0.3 / T3 0.4 / T4 0.5 SOL). Required before any
/// `activate_tier` / `upgrade_tier` / `activate_tier_otc` / `upgrade_tier_otc` call — all four
/// read this PDA for the flat SOL fee.
pub fn init_tier_fee_config(ctx: Context<InitTierFeeConfig>) -> Result<()> {
    let f = &mut ctx.accounts.tier_fee;
    f.tier_step_fee_lamports = TIER_STEP_FEE_LAMPORTS;
    f.bump = ctx.bumps.tier_fee;
    Ok(())
}

#[derive(Accounts)]
pub struct SetTierStepFee<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TIER_FEE], bump = tier_fee.bump)]
    pub tier_fee: Account<'info, TierFeeConfig>,
}

/// Admin-gated retune of one tier's flat SOL fee — e.g. rebalancing the ladder without a program
/// upgrade. `tier` is 1..=4; `lamports` must be > 0.
pub fn set_tier_step_fee(ctx: Context<SetTierStepFee>, tier: u8, lamports: u64) -> Result<()> {
    require!(
        (1..=TIER_COUNT as u8).contains(&tier),
        HubError::InvalidTier
    );
    require!(lamports > 0, HubError::ZeroAmount);
    let idx = (tier - 1) as usize;
    let f = &mut ctx.accounts.tier_fee;
    let old_lamports = f.tier_step_fee_lamports[idx];
    f.tier_step_fee_lamports[idx] = lamports;
    emit!(TierStepFeeUpdated {
        tier,
        old_lamports,
        new_lamports: lamports,
    });
    Ok(())
}
