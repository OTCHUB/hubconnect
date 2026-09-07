//! §B3 #11 consign_desk, #12 unconsign_desk, #13 build_lp.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::state::*;

#[derive(Accounts)]
pub struct ConsignDesk<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner verified + transferred via Core CPI (M2).
    #[account(mut)]
    pub desk_asset: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        constraint = !config.paused @ HubError::Paused,
        constraint = config.consignment_enabled @ HubError::ConsignmentDisabled
    )]
    pub config: Account<'info, Config>,
    /// CHECK: treasury vault recorded on TreasuryState.
    #[account(address = treasury_state.vault @ HubError::Unauthorized)]
    pub treasury_vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    #[account(
        init_if_needed, payer = owner, space = 8 + ConsignedDesk::INIT_SPACE,
        seeds = [SEED_CONSIGN, desk_asset.key().as_ref()], bump
    )]
    pub consigned_desk: Account<'info, ConsignedDesk>,
    /// CHECK: Metaplex Core program, validated in handler (M2).
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn consign_desk(_ctx: Context<ConsignDesk>) -> Result<()> {
    err!(HubError::NotImplemented)
}

#[derive(Accounts)]
pub struct UnconsignDesk<'info> {
    #[account(mut)]
    pub consignor: Signer<'info>,
    /// CHECK: Metaplex Core asset returned via Core CPI (M2).
    #[account(mut)]
    pub desk_asset: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump,
        constraint = epoch.finalized @ HubError::UnconsignBeforeFinalize
    )]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: treasury vault recorded on TreasuryState.
    #[account(address = treasury_state.vault @ HubError::Unauthorized)]
    pub treasury_vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    #[account(
        mut, seeds = [SEED_CONSIGN, desk_asset.key().as_ref()], bump = consigned_desk.bump,
        has_one = consignor @ HubError::Unauthorized,
        constraint = consigned_desk.active @ HubError::ConsignmentInactive
    )]
    pub consigned_desk: Account<'info, ConsignedDesk>,
    /// CHECK: Metaplex Core program, validated in handler (M2).
    pub mpl_core_program: UncheckedAccount<'info>,
}

pub fn unconsign_desk(_ctx: Context<UnconsignDesk>) -> Result<()> {
    err!(HubError::NotImplemented)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LpPair {
    HubSol,
    HubOtc,
}

#[derive(Accounts)]
pub struct BuildLp<'info> {
    pub treasury: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        has_one = treasury @ HubError::Unauthorized,
        constraint = config.lp_enabled @ HubError::LpDisabled
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: treasury LP-token vault PDA (custody only; withdraw path never sells HUB).
    #[account(mut)]
    pub lp_vault: UncheckedAccount<'info>,
    // AMM pool accounts passed as remaining_accounts (M2).
}

pub fn build_lp(
    _ctx: Context<BuildLp>,
    _pair: LpPair,
    _hub_amount: u64,
    _quote_amount: u64,
) -> Result<()> {
    err!(HubError::NotImplemented)
}
