//! §B3 #4 finalize_epoch, #6 register_treasury_inflow, #7 record_burn.
//!
//! Burn-pending and lp-pending are marked once, at finalize, with the rates in effect then
//! (§B3 #9: rate changes apply to future epochs).
//!
//! Rounds are threshold-gated, not clock-gated: `finalize_epoch` is callable the moment the open
//! epoch's inflow reaches `Config.min_pot_threshold_lamports` (OTC desk-pot semantics). §A5
//! split: 5% burn / 5% LP-pending / 90% $OTC leg. The $OTC leg's lamport-equivalent value is
//! credited to `Config.acc_per_weight` (unchanged mechanic) and its SOL is earmarked in
//! `OtcPotState.otc_pending_lamports` for `record_otc_buy`; `claim_yield` pays desks in $OTC
//! at the pot's lifetime average buy rate, so stakers still settle every closed round in one
//! claim.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::pot::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct FinalizeEpoch<'info> {
    /// Permissionless: the math is deterministic, so anyone may close a round once the
    /// threshold is met (they pay the next Epoch account's rent).
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
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
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

    // Whole lamports of dust re-enter as inflow. `dust_scaled` has two sources — round_credit's
    // floor/ceiling slack, and §B3 #8 void_tier's forfeited pending — and neither needs (or may
    // safely take) a fresh `pot_liability_lamports` credit here:
    //   - slack's lamports were already booked as liability by `book_inflow` when the fee that
    //     funded this round's inflow arrived; carrying it forward just defers which epoch's
    //     `credited`/accumulator bucket it lands in.
    //   - forfeited pending is a share of some past epoch's `credited` (also booked at
    //     `book_inflow` time). By the time it's voided that liability is either (a) still live,
    //     because `record_otc_buy` hasn't yet reimbursed that epoch's `otc_pending_lamports` in
    //     full — already counted, or (b) already retired in bulk by `record_otc_buy` (which
    //     subtracts a whole epoch's `credited` regardless of which desks actually claim) — in
    //     which case the $OTC it would have paid is unclaimed surplus sitting in `otc_vault`,
    //     not lamports sitting in the pot, so crediting it again here would manufacture
    //     liability with no pot SOL behind it and eventually underflow a real reimbursement.
    // Either way, `book_inflow`'s liability invariant already covers every lamport counted below.
    let carry = u64::try_from(config.dust_scaled / ACC_SCALE)
        .map_err(|_| error!(HubError::MathOverflow))?;
    config.dust_scaled %= ACC_SCALE;
    e.inflow_lamports = add(e.inflow_lamports, carry)?;
    require!(
        e.inflow_lamports >= config.min_pot_threshold_lamports,
        HubError::PotBelowThreshold
    );

    // §A5: 5% burn / 5% LP-pending / 90% $OTC leg (credited through the accumulator).
    let burn = bps_of(e.inflow_lamports, config.burn_pct_bp)?;
    let lp = bps_of(e.inflow_lamports, config.lp_pct_bp)?;
    let distributable = sub(sub(e.inflow_lamports, burn)?, lp)?;
    let (per_w, credited, slack) = round_credit(distributable, config.total_weight_bp)?;
    config.acc_per_weight = config
        .acc_per_weight
        .checked_add(per_w)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    add_dust(config, slack)?;

    e.total_weight_bp = config.total_weight_bp;
    e.burn_pending_lamports = burn;
    e.lp_pending_lamports = lp;
    e.distributed_lamports = credited;
    e.rolled_forward_lamports = sub(distributable, credited)?;
    e.per_weight_scaled = per_w;
    e.acc_per_weight_after = config.acc_per_weight;
    e.finalized_ts = now;
    e.finalized = true;
    assert_epoch_balanced(e)?;

    let b = &mut ctx.accounts.burn;
    b.burn_pending_lamports = add(b.burn_pending_lamports, burn)?;

    let op = &mut ctx.accounts.otc_pot;
    op.otc_pending_lamports = add(op.otc_pending_lamports, credited)?;

    let ts = &mut ctx.accounts.treasury_state;
    ts.lp_pending_lamports = add(ts.lp_pending_lamports, lp)?;

    // The floor remainder stays pot liability and opens the next round.
    let n = &mut ctx.accounts.next_epoch;
    n.index = add(epoch_index, 1)?;
    n.start_ts = now;
    n.finalized_ts = 0;
    n.inflow_lamports = e.rolled_forward_lamports;
    n.bump = ctx.bumps.next_epoch;
    config.current_epoch = n.index;

    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(EpochFinalized {
        index: epoch_index,
        inflow_lamports: e.inflow_lamports,
        distributed_lamports: e.distributed_lamports,
        burn_pending_lamports: burn,
        lp_pending_lamports: lp,
        rolled_forward_lamports: e.rolled_forward_lamports,
        total_weight_bp: e.total_weight_bp,
        per_weight_scaled: per_w,
        acc_per_weight: config.acc_per_weight,
    });
    Ok(())
}

/// §A5 inflow sources.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum InflowSource {
    B,
    C,
    D,
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
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.treasury,
        &ctx.accounts.pot,
        lamports,
    )?;
    let config = &mut ctx.accounts.config;
    book_inflow(config, &mut ctx.accounts.epoch, lamports)?;
    if source == InflowSource::D {
        ctx.accounts.treasury_state.total_exits = ctx
            .accounts
            .treasury_state
            .total_exits
            .checked_add(1)
            .ok_or(HubError::MathOverflow)?;
    }
    assert_pot_solvent(config, &ctx.accounts.pot)?;
    emit!(InflowRegistered {
        epoch: config.current_epoch,
        source: source as u8,
        lamports,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordBurn<'info> {
    /// Must be `burn.authority`: fronts SOL for the market buy, reimbursed here on proof of burn.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
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
