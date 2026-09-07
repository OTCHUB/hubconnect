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
    #[account(
        init_if_needed, payer = payer, space = 8 + DeskTier::INIT_SPACE,
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump
    )]
    pub desk_tier: Account<'info, DeskTier>,
    pub system_program: Program<'info, System>,
}

/// Fresh activation at T1, or re-activation of a voided tier (full price, §B5 wash-transfer).
pub fn activate_tier(ctx: Context<ActivateTier>) -> Result<()> {
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
    let fee = config.step_fee(0, 1)?;
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

    let epoch_idx = apply_activation(
        config,
        t,
        ctx.accounts.desk_asset.key(),
        asset.owner,
        ctx.bumps.desk_tier,
    )?;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(TierActivated {
        asset: t.asset_id,
        owner: asset.owner,
        tier: 1,
        epoch: epoch_idx,
        fee_lamports: fee,
        to_pot,
        to_ops,
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
    #[account(
        mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided @ HubError::TierVoided
    )]
    pub desk_tier: Account<'info, DeskTier>,
    pub system_program: Program<'info, System>,
}

/// Pay exactly the step difference to `target_tier`. Ownership change → void, no charge.
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
    let from = settle_for_upgrade(config, t)?;

    let fee = config.step_fee(from, target_tier)?;
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

    apply_upgrade(config, t, target_tier)?;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(TierUpgraded {
        asset: t.asset_id,
        owner: asset.owner,
        from_tier: from,
        to_tier: target_tier,
        epoch: config.current_epoch,
        fee_lamports: fee,
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
    pub system_program: Program<'info, System>,
}

/// One transaction settles every round closed since the tier's stamp:
/// `owed = ⌊(acc − stamp) × w / ACC_SCALE⌋`, the sub-lamport remainder goes to dust.
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

    t.stamp_acc_per_weight = config.acc_per_weight;
    t.total_claimed_lamports = add(t.total_claimed_lamports, owed)?;
    add_dust(config, frac)?;
    config.pot_liability_lamports = sub(config.pot_liability_lamports, owed)?;

    pay_from_pot(
        &ctx.accounts.system_program,
        &ctx.accounts.pot,
        &ctx.accounts.claimer,
        config.pot_bump,
        owed,
    )?;
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(YieldClaimed {
        asset: t.asset_id,
        claimer: ctx.accounts.claimer.key(),
        epoch: config.current_epoch,
        tier: t.tier,
        lamports: owed,
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
/// accumulator, enter T1 and add its weight to Σw. Returns the activation epoch.
pub(crate) fn apply_activation(
    config: &mut Config,
    t: &mut DeskTier,
    asset_id: Pubkey,
    owner: Pubkey,
    bump: u8,
) -> Result<u64> {
    let epoch_idx = config.current_epoch;
    t.asset_id = asset_id;
    t.owner_at_activation = owner;
    t.tier = 1;
    t.activated_epoch = epoch_idx;
    t.stamp_acc_per_weight = config.acc_per_weight;
    t.total_claimed_lamports = 0;
    t.voided = false;
    t.bump = bump;
    config.total_weight_bp = add(config.total_weight_bp, config.weight_bp(1)?)?;
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
    config.total_weight_bp = config.total_weight_bp.saturating_sub(w);
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
