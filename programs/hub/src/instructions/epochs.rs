//! §B3 #4 finalize_epoch, #6 register_treasury_inflow, #7 record_burn.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct FinalizeEpoch<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed, payer = keeper, space = 8 + Epoch::INIT_SPACE,
        seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(
        init_if_needed, payer = keeper, space = 8 + Epoch::INIT_SPACE,
        seeds = [SEED_EPOCH, &(epoch_index + 1).to_le_bytes()], bump
    )]
    pub next_epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_epoch(_ctx: Context<FinalizeEpoch>, _epoch_index: u64) -> Result<()> {
    err!(HubError::NotImplemented)
}

/// §A5 inflow sources. `E` (consigned desk yield) applies the consignor share split.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum InflowSource {
    B,
    C,
    D,
    E,
    F,
}

#[derive(Accounts)]
pub struct RegisterTreasuryInflow<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// Optional: consigned desk for source E.
    pub consigned_desk: Option<Account<'info, ConsignedDesk>>,
    /// Optional: consignor accrual for source E.
    #[account(mut)]
    pub consignor_accrual: Option<Account<'info, StakerAccrual>>,
    pub system_program: Program<'info, System>,
}

pub fn register_treasury_inflow(
    _ctx: Context<RegisterTreasuryInflow>,
    _source: InflowSource,
    _lamports: u64,
) -> Result<()> {
    err!(HubError::NotImplemented)
}

#[derive(Accounts)]
pub struct RecordBurn<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump, has_one = authority @ HubError::Unauthorized)]
    pub burn: Account<'info, BurnState>,
    /// CHECK: burn authority recorded on BurnState.
    pub authority: UncheckedAccount<'info>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
}

pub fn record_burn(
    _ctx: Context<RecordBurn>,
    _hub_burned: u64,
    _lamports_spent: u64,
    _burn_tx: [u8; 64],
) -> Result<()> {
    err!(HubError::NotImplemented)
}
