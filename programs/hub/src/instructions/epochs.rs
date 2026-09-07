//! §B3 #4 finalize_epoch, #6 register_treasury_inflow (+ consigned variant), #7 record_burn,
//! and claim_accrual (pays consignor-share credits recorded on StakerAccrual).
//!
//! Burn-pending is marked once, at finalize, with the rate in effect then
//! (§B3 #9: rate changes apply to future epochs).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::pot::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct FinalizeEpoch<'info> {
    /// Permissionless: the math is deterministic, so any keeper may close an ended epoch.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump = epoch.bump,
        constraint = !epoch.finalized @ HubError::EpochAlreadyFinalized
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(
        init, payer = keeper, space = 8 + Epoch::INIT_SPACE,
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

pub fn finalize_epoch(ctx: Context<FinalizeEpoch>, epoch_index: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let e = &mut ctx.accounts.epoch;
    require!(
        epoch_index == config.current_epoch,
        HubError::EpochNotCurrent
    );
    require!(now >= e.end_ts, HubError::EpochNotEnded);

    let burn = bps_of(e.inflow_lamports, config.burn_pct_bp)?;
    let distributable = sub(e.inflow_lamports, burn)?;
    e.total_weight_bp = config.total_weight_bp;
    e.burn_pending_lamports = burn;
    if e.total_weight_bp == 0 {
        e.rolled_forward_lamports = distributable;
        e.distributed_lamports = 0;
    } else {
        e.distributed_lamports = distributable;
        e.rolled_forward_lamports = 0;
    }
    e.finalized = true;
    assert_epoch_balanced(e)?;

    let b = &mut ctx.accounts.burn;
    b.burn_pending_lamports = add(b.burn_pending_lamports, burn)?;

    // Roll forward: the carry stays pot liability and becomes next epoch's opening inflow.
    let n = &mut ctx.accounts.next_epoch;
    n.index = add(epoch_index, 1)?;
    n.start_ts = e.end_ts;
    n.end_ts = e.end_ts + config.epoch_duration_secs as i64;
    n.inflow_lamports = e.rolled_forward_lamports;
    n.bump = ctx.bumps.next_epoch;
    config.current_epoch = n.index;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(EpochFinalized {
        index: epoch_index,
        inflow_lamports: e.inflow_lamports,
        distributed_lamports: e.distributed_lamports,
        burn_pending_lamports: burn,
        rolled_forward_lamports: e.rolled_forward_lamports,
        total_weight_bp: e.total_weight_bp,
    });
    Ok(())
}

/// §A5 inflow sources. `E` (consigned desk yield) uses `register_consigned_inflow`.
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
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    pub system_program: Program<'info, System>,
}

/// Sources B/C/D/F: treasury moves `lamports` into the pot and books them as epoch inflow.
pub fn register_treasury_inflow(
    ctx: Context<RegisterTreasuryInflow>,
    source: InflowSource,
    lamports: u64,
) -> Result<()> {
    require!(lamports > 0, HubError::ZeroAmount);
    require!(source != InflowSource::E, HubError::ConsignmentInactive);
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.treasury,
        &ctx.accounts.pot,
        lamports,
    )?;
    let config = &mut ctx.accounts.config;
    book_inflow(config, &mut ctx.accounts.epoch, lamports)?;
    if source == InflowSource::D {
        ctx.accounts.treasury_state.total_exits =
            ctx.accounts.treasury_state.total_exits.saturating_add(1);
    }
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(InflowRegistered {
        epoch: config.current_epoch,
        source: source as u8,
        lamports,
        consignor_share: 0
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterConsignedInflow<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_CONSIGN, consigned_desk.asset_id.as_ref()], bump = consigned_desk.bump,
        constraint = consigned_desk.active @ HubError::ConsignmentInactive
    )]
    pub consigned_desk: Account<'info, ConsignedDesk>,
    #[account(
        init_if_needed, payer = treasury, space = 8 + StakerAccrual::INIT_SPACE,
        seeds = [SEED_ACCRUAL, consigned_desk.consignor.as_ref(), &config.current_epoch.to_le_bytes()], bump
    )]
    pub consignor_accrual: Account<'info, StakerAccrual>,
    pub system_program: Program<'info, System>,
}

/// Source E: `consignor_share_bp` is credited to the consignor's accrual, remainder → pool.
pub fn register_consigned_inflow(
    ctx: Context<RegisterConsignedInflow>,
    lamports: u64,
) -> Result<()> {
    require!(lamports > 0, HubError::ZeroAmount);
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.treasury,
        &ctx.accounts.pot,
        lamports,
    )?;

    let config = &mut ctx.accounts.config;
    let share = bps_of(lamports, config.consignor_share_bp)?;
    let pool = sub(lamports, share)?;
    book_inflow(config, &mut ctx.accounts.epoch, pool)?;

    let a = &mut ctx.accounts.consignor_accrual;
    a.wallet = ctx.accounts.consigned_desk.consignor;
    a.epoch_index = config.current_epoch;
    a.owed_lamports = add(a.owed_lamports, share)?;
    a.bump = ctx.bumps.consignor_accrual;
    config.pot_liability_lamports = add(config.pot_liability_lamports, share)?;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(InflowRegistered {
        epoch: config.current_epoch,
        source: InflowSource::E as u8,
        lamports,
        consignor_share: share,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct ClaimAccrual<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_ACCRUAL, wallet.key().as_ref(), &epoch_index.to_le_bytes()], bump = accrual.bump,
        has_one = wallet @ HubError::Unauthorized
    )]
    pub accrual: Account<'info, StakerAccrual>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Pays a wallet-level accrual (consignor share). Independent of tiers and epoch finalize.
pub fn claim_accrual(ctx: Context<ClaimAccrual>, epoch_index: u64) -> Result<()> {
    let a = &mut ctx.accounts.accrual;
    let owed = a.owed_lamports;
    require!(owed > 0, HubError::AccrualEmpty);
    a.owed_lamports = 0;
    let config = &mut ctx.accounts.config;
    config.pot_liability_lamports = sub(config.pot_liability_lamports, owed)?;
    pay_from_pot(
        &ctx.accounts.system_program,
        &ctx.accounts.pot,
        &ctx.accounts.wallet,
        config.pot_bump,
        owed,
    )?;
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(AccrualClaimed {
        wallet: ctx.accounts.wallet.key(),
        epoch: epoch_index,
        lamports: owed
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordBurn<'info> {
    /// Must be `burn.authority`: fronts SOL for the market buy, reimbursed here on proof of burn.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_BURN], bump = burn.bump,
        constraint = burn.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub burn: Account<'info, BurnState>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Idempotency is the keeper's job (it checks `last_burn_tx` before resubmitting);
/// on-chain we refuse to spend past burn-pending, so a replay can never over-draw.
pub fn record_burn(
    ctx: Context<RecordBurn>,
    hub_burned: u64,
    lamports_spent: u64,
    burn_tx: [u8; 64],
) -> Result<()> {
    require!(lamports_spent > 0, HubError::ZeroAmount);
    let b = &mut ctx.accounts.burn;
    require!(
        lamports_spent <= b.burn_pending_lamports,
        HubError::BurnExceedsPending
    );
    require!(burn_tx != b.last_burn_tx, HubError::InvariantViolated);
    b.burn_pending_lamports = sub(b.burn_pending_lamports, lamports_spent)?;
    b.total_hub_burned = add(b.total_hub_burned, hub_burned)?;
    b.last_burn_tx = burn_tx;

    let config = &mut ctx.accounts.config;
    config.pot_liability_lamports = sub(config.pot_liability_lamports, lamports_spent)?;
    pay_from_pot(
        &ctx.accounts.system_program,
        &ctx.accounts.pot,
        &ctx.accounts.keeper,
        config.pot_bump,
        lamports_spent,
    )?;
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(BurnRecorded {
        hub_burned,
        lamports_spent,
        burn_pending_after: b.burn_pending_lamports
    });
    Ok(())
}
