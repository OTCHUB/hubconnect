//! §B3 #2 activate_tier, #3 upgrade_tier, #5 claim_yield (+ #8 void_tier internal path).
//!
//! Weight model: `Config.total_weight_bp` is the running Σw of live tiers and is
//! snapshotted into `Epoch` at finalize. Claims are sequential per tier
//! (`next_claim_epoch`), and upgrades require all finalized epochs to be claimed
//! first, so the weight used at claim time is always the weight that was in Σw.

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
    require!(t.tier == 0 || t.voided, HubError::TierAlreadyActive);

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

    let epoch_idx = config.current_epoch;
    t.asset_id = ctx.accounts.desk_asset.key();
    t.owner_at_activation = asset.owner;
    t.tier = 1;
    t.activated_epoch = epoch_idx;
    t.next_claim_epoch = epoch_idx;
    t.voided = false;
    t.bump = ctx.bumps.desk_tier;
    config.total_weight_bp = add(config.total_weight_bp, config.weight_bp(1)?)?;

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
    require!(t.tier < TIER_COUNT as u8, HubError::TierMaxed);
    require!(
        t.next_claim_epoch >= config.current_epoch,
        HubError::ClaimBeforeUpgrade
    );

    let from = t.tier;
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

    let delta = sub(config.weight_bp(target_tier)?, config.weight_bp(from)?)?;
    config.total_weight_bp = add(config.total_weight_bp, delta)?;
    t.tier = target_tier;

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
#[instruction(epoch_index: u64)]
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
    #[account(
        mut, seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump = epoch.bump,
        constraint = epoch.finalized @ HubError::EpochNotFinalized
    )]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Lazy revocation: if the desk changed hands since activation the tier is voided
/// (persisted, no refund, no payout) and the call returns Ok so the void sticks.
pub fn claim_yield(ctx: Context<ClaimYield>, epoch_index: u64) -> Result<()> {
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
    require!(epoch_index == t.next_claim_epoch, HubError::ClaimOutOfOrder);

    let e = &mut ctx.accounts.epoch;
    let w = config.weight_bp(t.tier)?;
    let remaining_weight = sub(e.total_weight_bp, e.claimed_weight_bp)?;
    require!(
        e.total_weight_bp > 0 && w <= remaining_weight,
        HubError::NotEligibleForEpoch
    );

    let owed = if w == remaining_weight {
        sub(e.distributed_lamports, e.claimed_lamports)?
    } else {
        let v = (e.distributed_lamports as u128 * w as u128) / e.total_weight_bp as u128;
        u64::try_from(v).map_err(|_| error!(HubError::MathOverflow))?
    };

    e.claimed_lamports = add(e.claimed_lamports, owed)?;
    e.claimed_weight_bp = add(e.claimed_weight_bp, w)?;
    t.next_claim_epoch = add(epoch_index, 1)?;
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
        epoch: epoch_index,
        tier: t.tier,
        lamports: owed,
    });
    Ok(())
}

/// §B3 #8 — internal path used by upgrade/claim when ownership changed.
pub(crate) fn void_tier(
    config: &mut Config,
    t: &mut DeskTier,
    current_owner: Pubkey,
) -> Result<()> {
    let w = config.weight_bp(t.tier)?;
    config.total_weight_bp = config.total_weight_bp.saturating_sub(w);
    t.voided = true;
    emit!(TierVoided {
        asset: t.asset_id,
        owner_at_activation: t.owner_at_activation,
        current_owner,
        tier: t.tier,
        epoch: config.current_epoch,
    });
    Ok(())
}
