//! §A5 90% leg — `init_otc_pot` (authority, one-time) and `record_otc_buy` (keeper-attested).
//! See `OtcPotState` doc comment in `state/mod.rs` for the full design:
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
pub struct SetOtcPotKeeper<'info> {
    /// `Config.authority` (admin), not `otc_pot.authority` itself — a compromised or retired
    /// keeper key can never rotate itself out from under the admin, and the admin can always
    /// move the pot to a fresh dedicated hot key without touching `Config`.
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
}

/// Admin-gated rotation of `OtcPotState.authority` — e.g. onboarding a dedicated low-privilege
/// `otc-buy` keeper hot wallet in place of the master deployer key `init_otc_pot` originally set.
/// Mirrors the key-custody pattern already used for `Config.treasury` (`update_config`'s
/// `ConfigField::Treasury`), just scoped to this one PDA instead of a `Config` field.
pub fn set_otc_pot_keeper(ctx: Context<SetOtcPotKeeper>, new_keeper: Pubkey) -> Result<()> {
    let old_keeper = ctx.accounts.otc_pot.authority;
    ctx.accounts.otc_pot.authority = new_keeper;
    emit!(OtcPotKeeperUpdated {
        old_keeper,
        new_keeper,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetOtcVault<'info> {
    /// `Config.authority` (admin) — same rationale as `SetOtcPotKeeper`: a migration lever that
    /// never depends on the (possibly compromised/retired) `otc_pot.authority` keeper key.
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    /// CHECK: spl-token account, mint = config.otc_mint, owner = `["pot"]` PDA — identical
    /// shape/validation to `init_otc_pot`'s `otc_vault` (see `require_token_account` below).
    pub new_otc_vault: UncheckedAccount<'info>,
}

/// Admin-gated repoint of `OtcPotState.otc_vault` to a freshly created token account for the
/// *current* `Config.otc_mint` — the only recovery path when `otc_vault`'s mint (fixed forever at
/// `init_otc_pot` time) has drifted from a later `Config.otc_mint` change (e.g. a devnet stub
/// mint recreated with `--force`, or a genuine mainnet token migration). Does not move any
/// balance already sitting in the old vault — callers should drain it first if it still holds
/// value; `record_otc_buy`'s `TransferChecked` would simply reject deposits into the stale vault
/// once `Config.otc_mint` and the vault's own mint disagree, so this exists to restore that
/// invariant without a program upgrade.
pub fn set_otc_vault(ctx: Context<SetOtcVault>) -> Result<()> {
    require_token_account(
        &ctx.accounts.new_otc_vault,
        &ctx.accounts.config.otc_mint,
        &ctx.accounts.config.pot,
    )?;
    let old_vault = ctx.accounts.otc_pot.otc_vault;
    ctx.accounts.otc_pot.otc_vault = ctx.accounts.new_otc_vault.key();
    emit!(OtcVaultUpdated {
        old_vault,
        new_vault: ctx.accounts.new_otc_vault.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordOtcBuy<'info> {
    /// Must be `otc_pot.authority`: fronts SOL for the market buy, reimbursed here on proof of
    /// deposit (the deposit itself is enforced on-chain below, not merely attested).
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
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
    /// CHECK: classic Token or Token-2022 program (dispatched to whichever `otc_mint` is
    /// actually owned by — $OTC is Token-2022), asserted in `transfer_checked`.
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
    require!(otc_bought > 0 && lamports_spent > 0, HubError::ZeroAmount);
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
