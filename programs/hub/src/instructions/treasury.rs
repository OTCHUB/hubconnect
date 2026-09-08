//! §B3 #13 build_lp (+ phase-2 build_lp_otc_locked).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::pot::add;
use crate::instructions::raydium_cpswap;
use crate::state::*;

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
    /// CHECK: treasury LP-token custody PDA (`["vault"]`); withdraw path never sells HUB.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub lp_vault: UncheckedAccount<'info>,
    // AMM pool accounts arrive as remaining_accounts once the graduation AMM is fixed (§A6.2).
}

/// Gates + position bookkeeping. The AMM deposit CPI is adapter-specific and lands
/// once the launch AMM is known; until then the instruction records intent only when
/// pool accounts are supplied, and rejects otherwise so no state drifts from reality.
pub fn build_lp(
    ctx: Context<BuildLp>,
    pair: LpPair,
    hub_amount: u64,
    quote_amount: u64,
) -> Result<()> {
    require!(hub_amount > 0 && quote_amount > 0, HubError::ZeroAmount);
    let config = &ctx.accounts.config;
    let ts = &mut ctx.accounts.treasury_state;
    match pair {
        LpPair::HubSol => require!(!ts.lp_hub_sol_active, HubError::LpPositionExists),
        LpPair::HubOtc => {
            let now = Clock::get()?.unix_timestamp;
            require!(
                config.lp_phase2_open_ts > 0 && now >= config.lp_phase2_open_ts,
                HubError::LpPhase2Gated
            );
            require!(!ts.lp_hub_otc_active, HubError::LpPositionExists);
        }
    }
    require!(!ctx.remaining_accounts.is_empty(), HubError::LpAccountsMissing);

    match pair {
        LpPair::HubSol => ts.lp_hub_sol_active = true,
        LpPair::HubOtc => ts.lp_hub_otc_active = true,
    }
    ts.lp_hub_deposited = ts
        .lp_hub_deposited
        .checked_add(hub_amount)
        .ok_or(HubError::MathOverflow)?;
    ts.lp_quote_deposited = ts
        .lp_quote_deposited
        .checked_add(quote_amount)
        .ok_or(HubError::MathOverflow)?;
    emit!(LpBuilt {
        pair: pair as u8,
        hub_amount,
        quote_amount
    });
    Ok(())
}

/// §A6.2 phase-2 — real Raydium CP-Swap `deposit` + `lock_cp_liquidity` CPI for the HUB/OTC
/// pair only (phase-1 HUB/SOL is graduation-owned, already non-custodial, nothing to lock).
/// Separate from `build_lp` so the plain bookkeeping path stays untouched for HUB/SOL top-ups;
/// this is the instruction that actually makes a HUB/OTC position permanent: deposit, then burn
/// the LP mint in the same tx via the locking program, retaining a fee-claim right forever.
#[derive(Accounts)]
pub struct BuildLpOtcLocked<'info> {
    pub treasury: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        has_one = treasury @ HubError::Unauthorized,
        constraint = config.lp_enabled @ HubError::LpDisabled
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: treasury LP-custody PDA (`["vault"]`); appears inside `remaining_accounts` as the
    /// deposit/lock authority — `invoke_signed` below elevates it to a signer via its seeds.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    // `remaining_accounts` = [Raydium `deposit` accounts][locking-program `lock_cp_liquidity`
    // accounts], split at `deposit_account_count`, both in each program's published IDL order.
}

#[allow(clippy::too_many_arguments)]
pub fn build_lp_otc_locked(
    ctx: Context<BuildLpOtcLocked>,
    hub_amount: u64,
    otc_amount: u64,
    lp_token_amount: u64,
    deposit_account_count: u8,
    with_metadata: bool,
) -> Result<()> {
    require!(hub_amount > 0 && otc_amount > 0 && lp_token_amount > 0, HubError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.config.lp_phase2_open_ts > 0 && now >= ctx.accounts.config.lp_phase2_open_ts,
        HubError::LpPhase2Gated
    );
    let n = deposit_account_count as usize;
    require!(
        n > 0 && n < ctx.remaining_accounts.len(),
        HubError::LpAccountsMissing
    );
    let (pool_accounts, lock_accounts) = ctx.remaining_accounts.split_at(n);

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];

    raydium_cpswap::deposit(pool_accounts, lp_token_amount, hub_amount, otc_amount, &[seeds])?;
    raydium_cpswap::lock_cp_liquidity(lock_accounts, lp_token_amount, with_metadata, &[seeds])?;

    let ts = &mut ctx.accounts.treasury_state;
    ts.lp_hub_otc_active = true;
    ts.lp_hub_deposited = add(ts.lp_hub_deposited, hub_amount)?;
    ts.lp_quote_deposited = add(ts.lp_quote_deposited, otc_amount)?;

    emit!(LpBuilt {
        pair: LpPair::HubOtc as u8,
        hub_amount,
        quote_amount: otc_amount,
    });
    emit!(LpLocked {
        pair: LpPair::HubOtc as u8,
        hub_amount,
        quote_amount: otc_amount,
    });
    Ok(())
}
