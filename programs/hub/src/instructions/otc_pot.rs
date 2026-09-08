//! §A5 90% leg — `init_otc_pot` (authority, one-time) and `record_otc_buy` (keeper-attested,
//! mirrors `record_burn`). See `OtcPotState` doc comment in `state/mod.rs` for the full design:
//! the keeper fronts SOL, buys $OTC on the market, deposits it into the program-custodied
//! `otc_vault` in the same tx (`TransferChecked`, enforced on-chain), then is reimbursed from
//! the pot up to `otc_pending_lamports`. `claim_yield` (tiers.rs) prices each desk's
//! lamport-equivalent entitlement in $OTC at the resulting lifetime average rate.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::otc_pay::{require_token_account, transfer_checked};
use crate::instructions::pot::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitOtcPot<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: spl-token account, mint = config.otc_mint, owner = `["pot"]` PDA (verified here).
    pub otc_vault: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + OtcPotState::INIT_SPACE, seeds = [SEED_OTC_POT], bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    pub system_program: Program<'info, System>,
}

/// Creates the $OTC yield-vault bookkeeping. `keeper` is the wallet trusted to call
/// `record_otc_buy` (may be a dedicated hot key distinct from `Config.authority`, mirroring
/// `BurnState.authority`).
pub fn init_otc_pot(ctx: Context<InitOtcPot>, keeper: Pubkey) -> Result<()> {
    require_token_account(
        &ctx.accounts.otc_vault,
        &ctx.accounts.config.otc_mint,
        &ctx.accounts.config.pot,
    )?;
    let p = &mut ctx.accounts.otc_pot;
    p.authority = keeper;
    p.otc_vault = ctx.accounts.otc_vault.key();
    p.otc_pending_lamports = 0;
    p.total_lamports_spent = 0;
    p.total_otc_bought_units = 0;
    p.last_buy_tx = [0u8; 64];
    p.bump = ctx.bumps.otc_pot;
    Ok(())
}

#[derive(Accounts)]
pub struct RecordOtcBuy<'info> {
    /// Must be `otc_pot.authority`: fronts SOL for the market buy, reimbursed here on proof of
    /// deposit (the deposit itself is enforced on-chain below, not merely attested).
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump,
        constraint = otc_pot.authority == keeper.key() @ HubError::Unauthorized
    )]
    pub otc_pot: Account<'info, OtcPotState>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: keeper's $OTC source account (mint/owner verified in handler).
    #[account(mut)]
    pub keeper_otc: UncheckedAccount<'info>,
    /// CHECK: OTC vault recorded on OtcPotState at init.
    #[account(mut, address = otc_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Idempotency is the keeper's job (it checks `last_buy_tx` before resubmitting); on-chain we
/// refuse to spend past `otc_pending_lamports`, so a replay can never over-draw the pot, and the
/// `TransferChecked` deposit means a keeper can never claim a buy it didn't actually fund.
pub fn record_otc_buy(
    ctx: Context<RecordOtcBuy>,
    otc_bought: u64,
    lamports_spent: u64,
    buy_tx: [u8; 64],
) -> Result<()> {
    require!(
        otc_bought > 0 && lamports_spent > 0,
        HubError::ZeroAmount
    );
    let p = &mut ctx.accounts.otc_pot;
    require!(
        lamports_spent <= p.otc_pending_lamports,
        HubError::OtcBuyExceedsPending
    );
    require!(buy_tx != p.last_buy_tx, HubError::InvariantViolated);
    require_token_account(
        &ctx.accounts.keeper_otc,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.keeper.key,
    )?;

    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.keeper_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.otc_vault,
        &ctx.accounts.keeper,
        otc_bought,
        &[],
    )?;

    p.otc_pending_lamports = sub(p.otc_pending_lamports, lamports_spent)?;
    p.total_lamports_spent = add(p.total_lamports_spent, lamports_spent)?;
    p.total_otc_bought_units = add(p.total_otc_bought_units, otc_bought)?;
    p.last_buy_tx = buy_tx;

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
    emit!(OtcBuyRecorded {
        otc_bought,
        lamports_spent,
        otc_pending_after: p.otc_pending_lamports,
        total_otc_bought_units: p.total_otc_bought_units,
        total_lamports_spent: p.total_lamports_spent,
    });
    Ok(())
}
