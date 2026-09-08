//! §A6.3 — the creator-fee flywheel: the treasury's pro-rata claim on the OTC launcher's 70%
//! holders-in-stock leg (it holds 2% of $HUB supply, §A7.1), already denominated in $OTC.
//! `record_creator_fee` deposits it into `creator_fee_vault`; once the pending balance clears
//! `clear_threshold_units`, `clear_creator_fees` splits the whole balance 80/5/5/5/5. The 80%
//! desk-pot leg is a direct, swap-free injection into `OtcPotState` in the same instruction —
//! it only raises `total_otc_bought_units`, mechanically lifting the lifetime average buy rate
//! for every desk. The other four 5% legs each need an off-chain swap: the keeper draws its
//! earmark (`draw_creator_fee_leg`, enforced `TransferChecked` out), executes the swap, then
//! attests the result (trust + idempotency-tx-hash + pending-cap, mirroring `record_burn`).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::otc_pay::{require_token_account, transfer_checked};
use crate::instructions::pot::{add, bps_of, sub};
use crate::state::*;

#[derive(Accounts)]
pub struct InitCreatorFeeState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: spl-token account, mint = config.otc_mint, owner = `["pot"]` PDA (verified here).
    pub creator_fee_vault: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + CreatorFeeState::INIT_SPACE, seeds = [SEED_CREATOR_FEE], bump)]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    pub system_program: Program<'info, System>,
}

pub fn init_creator_fee_state(
    ctx: Context<InitCreatorFeeState>,
    keeper: Pubkey,
    clear_threshold_units: u64,
) -> Result<()> {
    require!(clear_threshold_units > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.creator_fee_vault,
        &ctx.accounts.config.otc_mint,
        &ctx.accounts.config.pot,
    )?;
    let s = &mut ctx.accounts.creator_fee_state;
    s.authority = keeper;
    s.creator_fee_vault = ctx.accounts.creator_fee_vault.key();
    s.clear_threshold_units = clear_threshold_units;
    s.bump = ctx.bumps.creator_fee_state;
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCreatorFee<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump)]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: treasury's $OTC source account holding the claimed launcher holder-leg proceeds.
    #[account(mut)]
    pub treasury_otc: UncheckedAccount<'info>,
    /// CHECK: creator-fee vault recorded on CreatorFeeState at init.
    #[account(mut, address = creator_fee_state.creator_fee_vault @ HubError::InvalidTokenAccount)]
    pub creator_fee_vault: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}

/// Treasury deposits its claimed launcher holder-leg $OTC; enforced on-chain (`TransferChecked`,
/// not merely attested), mirroring `record_otc_buy`'s deposit enforcement.
pub fn record_creator_fee(ctx: Context<RecordCreatorFee>, otc_received: u64) -> Result<()> {
    require!(otc_received > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.treasury_otc,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.treasury.key,
    )?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.treasury_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.creator_fee_vault,
        &ctx.accounts.treasury,
        otc_received,
        &[],
    )?;
    let s = &mut ctx.accounts.creator_fee_state;
    s.pending_otc_units = add(s.pending_otc_units, otc_received)?;
    s.total_received_otc = add(s.total_received_otc, otc_received)?;
    emit!(CreatorFeeReceived {
        otc_received,
        pending_after: s.pending_otc_units,
        total_received: s.total_received_otc,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClearCreatorFees<'info> {
    /// Permissionless: the split is deterministic bp math, like `finalize_epoch`.
    #[account(mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump)]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: matched against config.otc_mint.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    /// CHECK: creator-fee vault; source of the direct 80% desk-pot injection.
    #[account(mut, address = creator_fee_state.creator_fee_vault @ HubError::InvalidTokenAccount)]
    pub creator_fee_vault: UncheckedAccount<'info>,
    /// CHECK: $OTC yield vault recorded on OtcPotState; destination of the 80% leg.
    #[account(mut, address = otc_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: system-owned lamport vault PDA; signs the vault-to-vault transfer (both $OTC
    /// token accounts are owned by this PDA — same custody design as `otc_vault`).
    #[account(seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}

/// Splits the whole pending balance 80/5/5/5/5 once it clears the threshold. The 80% leg moves
/// immediately (program-signed vault-to-vault transfer, no swap); the other four legs become
/// per-leg earmarks drawn by the keeper.
pub fn clear_creator_fees(ctx: Context<ClearCreatorFees>) -> Result<()> {
    let s = &mut ctx.accounts.creator_fee_state;
    let cleared = s.pending_otc_units;
    require!(
        cleared >= s.clear_threshold_units,
        HubError::CreatorFeeBelowThreshold
    );

    let burn = bps_of(cleared, CREATOR_FEE_BURN_BP)?;
    let lp = bps_of(cleared, CREATOR_FEE_LP_BP)?;
    let stack = bps_of(cleared, CREATOR_FEE_STACK_BP)?;
    let ops = bps_of(cleared, CREATOR_FEE_OPS_BP)?;
    // Desk-pot absorbs the floor-rounding remainder of the four minor legs (mirrors
    // `finalize_epoch`'s `distributable = inflow - burn - lp` dust-avoidance pattern).
    let desk_pot = sub(sub(sub(sub(cleared, burn)?, lp)?, stack)?, ops)?;

    s.pending_otc_units = 0;
    s.burn_pending_otc = add(s.burn_pending_otc, burn)?;
    s.lp_pending_otc = add(s.lp_pending_otc, lp)?;
    s.stack_pending_otc = add(s.stack_pending_otc, stack)?;
    s.ops_pending_otc = add(s.ops_pending_otc, ops)?;
    s.total_desk_pot_otc = add(s.total_desk_pot_otc, desk_pot)?;

    let pot_bump = ctx.accounts.config.pot_bump;
    let seeds: &[&[u8]] = &[SEED_POT, &[pot_bump]];
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.creator_fee_vault,
        &ctx.accounts.otc_mint,
        &ctx.accounts.otc_vault,
        &ctx.accounts.pot,
        desk_pot,
        &[seeds],
    )?;
    let op = &mut ctx.accounts.otc_pot;
    op.total_otc_bought_units = add(op.total_otc_bought_units, desk_pot)?;

    emit!(CreatorFeeCleared {
        cleared_otc: cleared,
        desk_pot_otc: desk_pot,
        burn_otc: burn,
        lp_otc: lp,
        stack_otc: stack,
        ops_otc: ops,
        otc_pot_total_bought_units_after: op.total_otc_bought_units,
    });
    Ok(())
}

/// Legs a keeper may draw for an off-chain swap. `DeskPot` is excluded — it's injected directly
/// by `clear_creator_fees`, no swap needed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreatorFeeLeg {
    Burn,
    Lp,
    Stack,
    Ops,
}

#[derive(Accounts)]
pub struct DrawCreatorFeeLeg<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump,
        constraint = creator_fee_state.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: creator-fee vault, source of the draw.
    #[account(mut, address = creator_fee_state.creator_fee_vault @ HubError::InvalidTokenAccount)]
    pub creator_fee_vault: UncheckedAccount<'info>,
    /// CHECK: keeper's $OTC destination account (mint/owner verified in handler).
    #[account(mut)]
    pub keeper_otc: UncheckedAccount<'info>,
    /// CHECK: system-owned lamport vault PDA; signs the vault outflow.
    #[account(seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}

pub fn draw_creator_fee_leg(
    ctx: Context<DrawCreatorFeeLeg>,
    leg: CreatorFeeLeg,
    otc_amount: u64,
) -> Result<()> {
    require!(otc_amount > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.keeper_otc,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.keeper.key,
    )?;
    let s = &mut ctx.accounts.creator_fee_state;
    let pending = match leg {
        CreatorFeeLeg::Burn => &mut s.burn_pending_otc,
        CreatorFeeLeg::Lp => &mut s.lp_pending_otc,
        CreatorFeeLeg::Stack => &mut s.stack_pending_otc,
        CreatorFeeLeg::Ops => &mut s.ops_pending_otc,
    };
    require!(otc_amount <= *pending, HubError::CreatorFeeLegExceedsPending);
    *pending -= otc_amount;
    let pending_after = *pending;
    match leg {
        CreatorFeeLeg::Burn => s.total_burn_otc = add(s.total_burn_otc, otc_amount)?,
        CreatorFeeLeg::Lp => s.total_lp_otc = add(s.total_lp_otc, otc_amount)?,
        CreatorFeeLeg::Stack => s.total_stack_otc = add(s.total_stack_otc, otc_amount)?,
        CreatorFeeLeg::Ops => s.total_ops_otc = add(s.total_ops_otc, otc_amount)?,
    }

    let pot_bump = ctx.accounts.config.pot_bump;
    let seeds: &[&[u8]] = &[SEED_POT, &[pot_bump]];
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.creator_fee_vault,
        &ctx.accounts.otc_mint,
        &ctx.accounts.keeper_otc,
        &ctx.accounts.pot,
        otc_amount,
        &[seeds],
    )?;
    emit!(CreatorFeeLegDrawn {
        leg: leg as u8,
        otc_amount,
        pending_after,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCreatorFeeBurnResult<'info> {
    pub keeper: Signer<'info>,
    #[account(
        mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump,
        constraint = creator_fee_state.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
}

/// Attests a burn already executed off-chain from a drawn `Burn` leg (swap $OTC→$HUB, then
/// `BurnChecked`) — trust + idempotency-tx-hash + the pending-cap already enforced at draw time,
/// mirroring `record_burn`'s model exactly (this program cannot cheaply verify an external burn
/// on-chain any more than it can verify an external swap).
pub fn record_creator_fee_burn_result(
    ctx: Context<RecordCreatorFeeBurnResult>,
    otc_spent: u64,
    hub_burned: u64,
    burn_tx: [u8; 64],
) -> Result<()> {
    require!(hub_burned > 0, HubError::ZeroAmount);
    let s = &mut ctx.accounts.creator_fee_state;
    require!(burn_tx != s.last_burn_result_tx, HubError::InvariantViolated);
    s.last_burn_result_tx = burn_tx;
    s.total_burn_hub = add(s.total_burn_hub, hub_burned)?;
    let b = &mut ctx.accounts.burn;
    b.total_hub_burned = add(b.total_hub_burned, hub_burned)?;
    emit!(CreatorFeeBurnRecorded {
        otc_spent,
        hub_burned,
        total_hub_burned_after: b.total_hub_burned,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCreatorFeeStack<'info> {
    pub keeper: Signer<'info>,
    #[account(
        mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump,
        constraint = creator_fee_state.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
}

/// Attests $HUB swapped from a drawn `Stack` leg and moved into the treasury's HUB float
/// (a plain wallet-to-wallet token transfer outside this program's custody — the treasury
/// multisig already holds the $HUB float, §A7.1 `TREASURY_HUB_FLOAT_CAP_BP`).
pub fn record_creator_fee_stack(
    ctx: Context<RecordCreatorFeeStack>,
    otc_spent: u64,
    hub_amount: u64,
    stack_tx: [u8; 64],
) -> Result<()> {
    require!(hub_amount > 0, HubError::ZeroAmount);
    let s = &mut ctx.accounts.creator_fee_state;
    require!(stack_tx != s.last_stack_tx, HubError::InvariantViolated);
    s.last_stack_tx = stack_tx;
    s.total_stack_hub = add(s.total_stack_hub, hub_amount)?;
    emit!(CreatorFeeStackRecorded {
        otc_spent,
        hub_amount,
        total_stack_hub_after: s.total_stack_hub,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCreatorFeeOps<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_CREATOR_FEE], bump = creator_fee_state.bump,
        constraint = creator_fee_state.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub creator_fee_state: Account<'info, CreatorFeeState>,
    /// CHECK: `Config.ops_wallet`, enforced by `address`.
    #[account(mut, address = config.ops_wallet)]
    pub ops_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Enforced (not attested) — the keeper's post-swap SOL lands in `ops_wallet` in the same tx
/// as the ledger update, refilling the reserve the sweeper's arbitrage logic never drains.
pub fn record_creator_fee_ops(ctx: Context<RecordCreatorFeeOps>, otc_spent: u64, sol_amount: u64) -> Result<()> {
    require!(sol_amount > 0, HubError::ZeroAmount);
    invoke(
        &system_instruction::transfer(ctx.accounts.keeper.key, ctx.accounts.ops_wallet.key, sol_amount),
        &[
            ctx.accounts.keeper.to_account_info(),
            ctx.accounts.ops_wallet.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;
    let s = &mut ctx.accounts.creator_fee_state;
    s.total_ops_sol_lamports = add(s.total_ops_sol_lamports, sol_amount)?;
    emit!(CreatorFeeOpsRecorded {
        otc_spent,
        sol_amount,
        total_ops_sol_after: s.total_ops_sol_lamports,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors `clear_creator_fees`'s split exactly: four 5% legs floor-divided, the 80%
    /// desk-pot leg absorbs the remainder. 1,000 $OTC (6 decimals) clears clean with zero dust.
    #[test]
    fn split_is_80_5_5_5_5_with_desk_pot_absorbing_dust() {
        let cleared = 1_000_000_000u64; // 1,000 $OTC @ 6 decimals
        let burn = bps_of(cleared, CREATOR_FEE_BURN_BP).unwrap();
        let lp = bps_of(cleared, CREATOR_FEE_LP_BP).unwrap();
        let stack = bps_of(cleared, CREATOR_FEE_STACK_BP).unwrap();
        let ops = bps_of(cleared, CREATOR_FEE_OPS_BP).unwrap();
        let desk_pot = sub(sub(sub(sub(cleared, burn).unwrap(), lp).unwrap(), stack).unwrap(), ops)
            .unwrap();
        assert_eq!(burn, 50_000_000);
        assert_eq!(lp, 50_000_000);
        assert_eq!(stack, 50_000_000);
        assert_eq!(ops, 50_000_000);
        assert_eq!(desk_pot, 800_000_000);
        assert_eq!(desk_pot + burn + lp + stack + ops, cleared);

        // An amount that doesn't divide evenly by 10,000 still balances exactly — the desk-pot
        // leg (derived as a remainder, never bp-computed directly) absorbs all floor dust.
        let odd = 1_234_567u64;
        let burn = bps_of(odd, CREATOR_FEE_BURN_BP).unwrap();
        let lp = bps_of(odd, CREATOR_FEE_LP_BP).unwrap();
        let stack = bps_of(odd, CREATOR_FEE_STACK_BP).unwrap();
        let ops = bps_of(odd, CREATOR_FEE_OPS_BP).unwrap();
        let desk_pot =
            sub(sub(sub(sub(odd, burn).unwrap(), lp).unwrap(), stack).unwrap(), ops).unwrap();
        assert_eq!(desk_pot + burn + lp + stack + ops, odd);
    }
}
