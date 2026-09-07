//! §B3 #2 activate_tier, #3 upgrade_tier, #5 claim_yield (+ #8 void_tier internal).
//! M1: account shapes + constraints only; math/ownership checks land in M2.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::state::*;

#[derive(Accounts)]
pub struct ActivateTier<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership + collection verified in handler (M2).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
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
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
    pub system_program: Program<'info, System>,
}

pub fn activate_tier(_ctx: Context<ActivateTier>) -> Result<()> {
    err!(HubError::NotImplemented)
}

#[derive(Accounts)]
pub struct UpgradeTier<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership re-verified in handler (lazy revocation).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
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
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
    pub system_program: Program<'info, System>,
}

pub fn upgrade_tier(_ctx: Context<UpgradeTier>) -> Result<()> {
    err!(HubError::NotImplemented)
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct ClaimYield<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership re-verified NOW (§B3 #5).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump)]
    pub desk_tier: Account<'info, DeskTier>,
    #[account(
        seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump = epoch.bump,
        constraint = epoch.finalized @ HubError::EpochNotFinalized
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(
        init_if_needed, payer = claimer, space = 8 + StakerAccrual::INIT_SPACE,
        seeds = [SEED_ACCRUAL, claimer.key().as_ref(), &epoch_index.to_le_bytes()], bump
    )]
    pub accrual: Account<'info, StakerAccrual>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_yield(_ctx: Context<ClaimYield>, _epoch_index: u64) -> Result<()> {
    err!(HubError::NotImplemented)
}

/// §B3 #8 — internal path used by upgrade/claim when ownership changed.
#[allow(dead_code)]
pub(crate) fn void_tier(tier: &mut DeskTier) {
    tier.voided = true;
}
