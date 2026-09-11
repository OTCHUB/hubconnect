//! §B3 #13 build_lp (+ phase-2 build_lp_otc_locked).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::jupiter_swap::read_token_amount;
use crate::instructions::otc_pay::require_token_account;
use crate::instructions::pot::add;
use crate::instructions::raydium_cpswap;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LpPair {
    HubSol,
    HubOtc,
    /// §A5.1 MemeStock basket extension — HUB paired with CRCLx / NVDAx / SPCXx.
    /// Seeded once via `build_lp_basket_locked`, compounded via `compound_lp_basket`, harvested
    /// via `harvest_lp_fees`. See `basket_index` for the `TreasuryState.lp_basket_*` array slot
    /// each maps to.
    HubCrclx,
    HubNvdax,
    HubSpcxx,
}

impl LpPair {
    /// `TreasuryState.lp_basket_*` array index for the three MemeStock basket pairs; `None` for
    /// `HubSol`/`HubOtc`, which have their own dedicated (non-array) fields.
    pub fn basket_index(self) -> Option<usize> {
        match self {
            LpPair::HubCrclx => Some(0),
            LpPair::HubNvdax => Some(1),
            LpPair::HubSpcxx => Some(2),
            LpPair::HubSol | LpPair::HubOtc => None,
        }
    }
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
        // The basket pairs have their own dedicated, locked-only entry point
        // (`build_lp_basket_locked`) — this bookkeeping-only path never applies to them.
        LpPair::HubCrclx | LpPair::HubNvdax | LpPair::HubSpcxx => {
            return Err(error!(HubError::InvalidLpPair));
        }
    }
    require!(
        !ctx.remaining_accounts.is_empty(),
        HubError::LpAccountsMissing
    );

    match pair {
        LpPair::HubSol => ts.lp_hub_sol_active = true,
        LpPair::HubOtc => ts.lp_hub_otc_active = true,
        LpPair::HubCrclx | LpPair::HubNvdax | LpPair::HubSpcxx => {
            return Err(error!(HubError::InvalidLpPair));
        }
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
    require!(
        hub_amount > 0 && otc_amount > 0 && lp_token_amount > 0,
        HubError::ZeroAmount
    );
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

    raydium_cpswap::deposit(
        pool_accounts,
        lp_token_amount,
        hub_amount,
        otc_amount,
        &[seeds],
    )?;
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

/// §A6.2 phase-2 auto-compounder — permissionless, threshold-gated sibling of
/// `build_lp_otc_locked` that closes the gap between what `finalize_epoch` earmarks
/// (`TreasuryState.lp_pending_hub_units`, physically sitting in `vault_hub`) and the deposit
/// step, which was otherwise only reachable via a manual, treasury-signed call. Mirrors
/// `FinalizeEpoch`'s trust model (deterministic math + on-chain balance ties): any keeper may
/// call it once the pending earmark clears `LP_COMPOUND_MIN_HUB_UNITS`, no treasury signature
/// required.
///
/// The caller still supplies `otc_amount` / `lp_token_amount` / the Raydium CPI account list —
/// this program has no price oracle to derive them itself, same posture as
/// `build_lp_otc_locked`. Uncapped (see `LP_TARGET_SOL_LAMPORTS`'s doc comment): the position is
/// locked forever and only ever grows, so there is nothing to cap or burn-excess — the *entire*
/// pending earmark is deposited every call, no partial burn leg. `hub_mint`/`vault_hub`/`burn`
/// remain declared (unused by this handler) only so the account list stays stable; a future
/// revision may repurpose them.
#[derive(Accounts)]
pub struct CompoundLpOtc<'info> {
    /// Permissionless — no `has_one` check, mirrors `FinalizeEpoch { keeper: Signer }`.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.lp_enabled @ HubError::LpDisabled
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; authority over the deposit/lock CPIs below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; unused (no burn leg — kept for account-list
    /// stability, see doc comment above).
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: vault-owned $HUB scratch ATA — `lp_pending_hub_units`' physical custody and the
    /// deposit source below.
    #[account(mut, address = treasury_state.vault_hub @ HubError::InvalidTokenAccount)]
    pub vault_hub: UncheckedAccount<'info>,
    /// Unused (no burn leg) — kept for account-list stability, see doc comment above.
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Account<'info, BurnState>,
    /// CHECK: classic SPL Token program, asserted in the token-program helpers.
    pub token_program: UncheckedAccount<'info>,
    // `remaining_accounts` = [Raydium `deposit` accounts][locking-program `lock_cp_liquidity`
    // accounts], split at `deposit_account_count` — same convention as `build_lp_otc_locked`.
}

pub fn compound_lp_otc(
    ctx: Context<CompoundLpOtc>,
    otc_amount: u64,
    lp_token_amount: u64,
    deposit_account_count: u8,
    with_metadata: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.config.lp_phase2_open_ts > 0 && now >= ctx.accounts.config.lp_phase2_open_ts,
        HubError::LpPhase2Gated
    );

    let pending = ctx.accounts.treasury_state.lp_pending_hub_units;
    require!(
        pending >= LP_COMPOUND_MIN_HUB_UNITS,
        HubError::LpCompoundBelowThreshold
    );
    require!(otc_amount > 0 && lp_token_amount > 0, HubError::ZeroAmount);

    let n = deposit_account_count as usize;
    require!(
        n > 0 && n < ctx.remaining_accounts.len(),
        HubError::LpAccountsMissing
    );
    let (pool_accounts, lock_accounts) = ctx.remaining_accounts.split_at(n);

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];

    raydium_cpswap::deposit(
        pool_accounts,
        lp_token_amount,
        pending,
        otc_amount,
        &[seeds],
    )?;
    raydium_cpswap::lock_cp_liquidity(lock_accounts, lp_token_amount, with_metadata, &[seeds])?;

    let ts = &mut ctx.accounts.treasury_state;
    ts.lp_hub_otc_active = true;
    ts.lp_hub_deposited = add(ts.lp_hub_deposited, pending)?;
    ts.lp_quote_deposited = add(ts.lp_quote_deposited, otc_amount)?;
    // The whole earmark this call ties to is now deposited, so it no longer sits pending.
    ts.lp_pending_hub_units = 0;

    emit!(LpBuilt {
        pair: LpPair::HubOtc as u8,
        hub_amount: pending,
        quote_amount: otc_amount,
    });
    emit!(LpLocked {
        pair: LpPair::HubOtc as u8,
        hub_amount: pending,
        quote_amount: otc_amount,
    });
    emit!(LpCompounded {
        pair: LpPair::HubOtc as u8,
        hub_pending_before: pending,
        hub_deposited: pending,
        quote_deposited: otc_amount,
    });
    Ok(())
}

/// §A5.1 basket extension of `build_lp_otc_locked` — treasury-signed, seeds (or tops up) one of
/// the three MemeStock basket pairs' locked Raydium CP-Swap position in one deposit+lock CPI.
/// Generalized instead of duplicated ×3 since the CPI account lists are identical in shape
/// (only the quote mint differs, and this program never names token mints in these structs
/// anyway — see `build_lp_otc_locked`'s own doc comment on why).
#[derive(Accounts)]
pub struct BuildLpBasketLocked<'info> {
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
    // accounts], split at `deposit_account_count`, same convention as `build_lp_otc_locked`.
}

#[allow(clippy::too_many_arguments)]
pub fn build_lp_basket_locked(
    ctx: Context<BuildLpBasketLocked>,
    pair: LpPair,
    hub_amount: u64,
    quote_amount: u64,
    lp_token_amount: u64,
    deposit_account_count: u8,
    with_metadata: bool,
) -> Result<()> {
    let idx = pair
        .basket_index()
        .ok_or_else(|| error!(HubError::InvalidLpPair))?;
    require!(
        hub_amount > 0 && quote_amount > 0 && lp_token_amount > 0,
        HubError::ZeroAmount
    );
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

    raydium_cpswap::deposit(
        pool_accounts,
        lp_token_amount,
        hub_amount,
        quote_amount,
        &[seeds],
    )?;
    raydium_cpswap::lock_cp_liquidity(lock_accounts, lp_token_amount, with_metadata, &[seeds])?;

    let ts = &mut ctx.accounts.treasury_state;
    ts.lp_basket_active[idx] = true;
    ts.lp_basket_hub_deposited[idx] = add(ts.lp_basket_hub_deposited[idx], hub_amount)?;
    ts.lp_basket_quote_deposited[idx] = add(ts.lp_basket_quote_deposited[idx], quote_amount)?;

    emit!(LpBuilt {
        pair: pair as u8,
        hub_amount,
        quote_amount,
    });
    emit!(LpLocked {
        pair: pair as u8,
        hub_amount,
        quote_amount,
    });
    Ok(())
}

/// §A5.1 basket sibling of `compound_lp_otc` — permissionless, threshold-gated, uncapped for the
/// same reason (locked forever, only ever grows). Unlike HUB/OTC, the basket pairs have no
/// `finalize_epoch` earmark; `lp_basket_pending_hub_units[idx]` is fed exclusively by
/// `harvest_lp_fees`' HUB-side yield leg, so this can only ever compound a position that
/// `build_lp_basket_locked` already seeded (`InvalidLpPair` if not yet active).
#[derive(Accounts)]
pub struct CompoundLpBasket<'info> {
    /// Permissionless — no `has_one` check, mirrors `compound_lp_otc`.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.lp_enabled @ HubError::LpDisabled
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; authority over the deposit/lock CPIs below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    // `remaining_accounts` = [Raydium `deposit` accounts][locking-program `lock_cp_liquidity`
    // accounts], split at `deposit_account_count`.
}

#[allow(clippy::too_many_arguments)]
pub fn compound_lp_basket(
    ctx: Context<CompoundLpBasket>,
    pair: LpPair,
    quote_amount: u64,
    lp_token_amount: u64,
    deposit_account_count: u8,
    with_metadata: bool,
) -> Result<()> {
    let idx = pair
        .basket_index()
        .ok_or_else(|| error!(HubError::InvalidLpPair))?;
    require!(
        ctx.accounts.treasury_state.lp_basket_active[idx],
        HubError::InvalidLpPair
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.config.lp_phase2_open_ts > 0 && now >= ctx.accounts.config.lp_phase2_open_ts,
        HubError::LpPhase2Gated
    );

    let pending = ctx.accounts.treasury_state.lp_basket_pending_hub_units[idx];
    require!(
        pending >= LP_COMPOUND_MIN_HUB_UNITS,
        HubError::LpCompoundBelowThreshold
    );
    require!(
        quote_amount > 0 && lp_token_amount > 0,
        HubError::ZeroAmount
    );

    let n = deposit_account_count as usize;
    require!(
        n > 0 && n < ctx.remaining_accounts.len(),
        HubError::LpAccountsMissing
    );
    let (pool_accounts, lock_accounts) = ctx.remaining_accounts.split_at(n);

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];

    raydium_cpswap::deposit(
        pool_accounts,
        lp_token_amount,
        pending,
        quote_amount,
        &[seeds],
    )?;
    raydium_cpswap::lock_cp_liquidity(lock_accounts, lp_token_amount, with_metadata, &[seeds])?;

    let ts = &mut ctx.accounts.treasury_state;
    ts.lp_basket_hub_deposited[idx] = add(ts.lp_basket_hub_deposited[idx], pending)?;
    ts.lp_basket_quote_deposited[idx] = add(ts.lp_basket_quote_deposited[idx], quote_amount)?;
    ts.lp_basket_pending_hub_units[idx] = 0;

    emit!(LpBuilt {
        pair: pair as u8,
        hub_amount: pending,
        quote_amount,
    });
    emit!(LpLocked {
        pair: pair as u8,
        hub_amount: pending,
        quote_amount,
    });
    emit!(LpCompounded {
        pair: pair as u8,
        hub_pending_before: pending,
        hub_deposited: pending,
        quote_deposited: quote_amount,
    });
    Ok(())
}

/// §A5.1/§A6.2 yield leg — permissionless harvest of a locked position's accrued Raydium
/// CP-Swap trading fees (`raydium_cpswap::collect_cp_fees`), closing the loop the basket's
/// carve-out promises: "utilize generated fee revenue to feed additional income and yield back
/// into the HUB Pot." Works for any already-locked pair (`HubOtc` or a seeded basket pair);
/// `HubSol` has no locked position (`InvalidLpPair`).
///
/// The two recipient token accounts (`vault_hub` for the HUB-side leg, `quote_vault` for the
/// pair's quote-side leg) are read before/after the CPI — same balance-delta trust model as
/// `jupiter_swap::swap_exact_in` — since Raydium's `collect_cp_fees` has no return value. The
/// HUB-side harvest feeds straight back into *this pair's own* pending compounding earmark
/// (`lp_pending_hub_units` for `HubOtc`, `lp_basket_pending_hub_units[idx]` for a basket pair) —
/// thicker LP over time, no treasury signature needed. The quote-side harvest is credited
/// directly to `HubPotConfig`'s matching bucket (`otc`/`crclx`/`nvdax`/`spcxx`
/// pending+deposited units) — real yield flowing back to desk-holders — *provided* `quote_vault`
/// is that bucket's own vault-owned ATA (verified against `hub_pot` in the handler), so the
/// harvested tokens are already sitting where `open_hub_pot_round`/`distribute_hub_pot_reward`
/// expect them, no extra transfer required.
#[derive(Accounts)]
pub struct HarvestLpFees<'info> {
    /// Permissionless — no `has_one` check, mirrors `compound_lp_otc`.
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Account<'info, HubPotConfig>,
    /// CHECK: program-signed custody PDA; the fee-claim NFT's recorded owner, elevated to signer
    /// for the harvest CPI below via its seeds.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: vault-owned $HUB scratch ATA — the harvest CPI's HUB-side recipient; balance-delta
    /// read before/after to learn the harvested amount (same account `finalize_epoch` /
    /// `compound_lp_otc` already use as `lp_pending_hub_units`' physical custody).
    #[account(mut, address = treasury_state.vault_hub @ HubError::InvalidTokenAccount)]
    pub vault_hub: UncheckedAccount<'info>,
    /// CHECK: the harvest CPI's quote-side recipient — must equal `hub_pot`'s vault for the
    /// mint this `pair` corresponds to (checked in the handler, since which field depends on
    /// the `pair` argument, not resolvable in an `#[account(address = ...)]` constraint alone).
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,
    // `remaining_accounts` = locking-program `collect_cp_fees` accounts, in its IDL order (see
    // `raydium_cpswap::collect_cp_fees`'s doc comment for the expected shape).
}

pub fn harvest_lp_fees(ctx: Context<HarvestLpFees>, pair: LpPair) -> Result<()> {
    require!(pair != LpPair::HubSol, HubError::InvalidLpPair);
    let hp = &ctx.accounts.hub_pot;
    let expected_quote_vault = match pair {
        LpPair::HubOtc => hp.otc_vault,
        LpPair::HubCrclx => hp.crclx_vault,
        LpPair::HubNvdax => hp.nvdax_vault,
        LpPair::HubSpcxx => hp.spcxx_vault,
        LpPair::HubSol => unreachable!(),
    };
    require_keys_eq!(
        ctx.accounts.quote_vault.key(),
        expected_quote_vault,
        HubError::InvalidTokenAccount
    );
    if let Some(idx) = pair.basket_index() {
        require!(
            ctx.accounts.treasury_state.lp_basket_active[idx],
            HubError::InvalidLpPair
        );
    } else {
        require!(
            ctx.accounts.treasury_state.lp_hub_otc_active,
            HubError::InvalidLpPair
        );
    }

    require!(
        !ctx.remaining_accounts.is_empty(),
        HubError::LpAccountsMissing
    );
    let hub_before = read_token_amount(&ctx.accounts.vault_hub.to_account_info())?;
    let quote_before = read_token_amount(&ctx.accounts.quote_vault.to_account_info())?;

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];
    raydium_cpswap::collect_cp_fees(ctx.remaining_accounts, &[seeds])?;

    let hub_after = read_token_amount(&ctx.accounts.vault_hub.to_account_info())?;
    let quote_after = read_token_amount(&ctx.accounts.quote_vault.to_account_info())?;
    let hub_harvested = hub_after
        .checked_sub(hub_before)
        .ok_or_else(|| error!(HubError::HarvestBalanceUnderflow))?;
    let quote_harvested = quote_after
        .checked_sub(quote_before)
        .ok_or_else(|| error!(HubError::HarvestBalanceUnderflow))?;

    if hub_harvested > 0 {
        let ts = &mut ctx.accounts.treasury_state;
        match pair.basket_index() {
            Some(idx) => {
                ts.lp_basket_pending_hub_units[idx] =
                    add(ts.lp_basket_pending_hub_units[idx], hub_harvested)?;
            }
            None => {
                ts.lp_pending_hub_units = add(ts.lp_pending_hub_units, hub_harvested)?;
            }
        }
    }
    if quote_harvested > 0 {
        let hp = &mut ctx.accounts.hub_pot;
        match pair {
            LpPair::HubOtc => {
                hp.otc_pending_units = add(hp.otc_pending_units, quote_harvested)?;
                hp.otc_deposited_units = add(hp.otc_deposited_units, quote_harvested)?;
            }
            LpPair::HubCrclx => {
                hp.crclx_pending_units = add(hp.crclx_pending_units, quote_harvested)?;
                hp.crclx_deposited_units = add(hp.crclx_deposited_units, quote_harvested)?;
            }
            LpPair::HubNvdax => {
                hp.nvdax_pending_units = add(hp.nvdax_pending_units, quote_harvested)?;
                hp.nvdax_deposited_units = add(hp.nvdax_deposited_units, quote_harvested)?;
            }
            LpPair::HubSpcxx => {
                hp.spcxx_pending_units = add(hp.spcxx_pending_units, quote_harvested)?;
                hp.spcxx_deposited_units = add(hp.spcxx_deposited_units, quote_harvested)?;
            }
            LpPair::HubSol => unreachable!(),
        }
    }

    emit!(LpFeesHarvested {
        pair: pair as u8,
        hub_harvested,
        quote_harvested,
    });
    Ok(())
}

/// §A6.3/§A7.1 bridge, one-time post-init (mirrors `init_otc_pot`) — records the four
/// vault-owned (`["vault"]` PDA) token accounts `finalize_epoch`'s synchronous Jupiter legs and
/// `otc_pay.rs`'s swap-burn leg need: a WSOL scratch ATA (SOL→USDC hop funding), a USDC scratch
/// ATA (the two-hop price-discovery swap's intermediate hop, WSOL→USDC→$HUB), a $HUB scratch ATA
/// (every swap's destination, and `lp_pending_hub_units`'s physical custody), and the $HUB
/// buy-and-hold float ATA (treasury-float leg's destination, capped at `hub_float_cap_bp`).
#[derive(Accounts)]
pub struct InitTreasuryFloat<'info> {
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; must own the four ATAs below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = native (WSOL), owner = vault (verified in handler).
    pub vault_wsol: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.usdc_mint, owner = vault (verified in handler).
    pub vault_usdc: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.hub_mint, owner = vault (verified in handler).
    pub vault_hub: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.hub_mint, owner = vault (verified in handler).
    pub treasury_float_vault: UncheckedAccount<'info>,
}

pub fn init_treasury_float(ctx: Context<InitTreasuryFloat>) -> Result<()> {
    require_token_account(&ctx.accounts.vault_wsol, &WSOL_MINT, ctx.accounts.vault.key)?;
    require_token_account(
        &ctx.accounts.vault_usdc,
        &ctx.accounts.config.usdc_mint,
        ctx.accounts.vault.key,
    )?;
    require_token_account(
        &ctx.accounts.vault_hub,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.vault.key,
    )?;
    require_token_account(
        &ctx.accounts.treasury_float_vault,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.vault.key,
    )?;
    let ts = &mut ctx.accounts.treasury_state;
    ts.vault_wsol = ctx.accounts.vault_wsol.key();
    ts.vault_usdc = ctx.accounts.vault_usdc.key();
    ts.vault_hub = ctx.accounts.vault_hub.key();
    ts.treasury_float_vault = ctx.accounts.treasury_float_vault.key();
    emit!(TreasuryFloatInitialized {
        vault_wsol: ts.vault_wsol,
        vault_usdc: ts.vault_usdc,
        vault_hub: ts.vault_hub,
        treasury_float_vault: ts.treasury_float_vault,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetTreasuryFloatCapBp<'info> {
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
}

/// Experimental parameter (§A6.3/§A7.1 "we are experimenting"): the treasury multisig may
/// retune the float cap at will. Excess over the live cap at deposit time is burned, never
/// rejected — see `finalize_epoch`.
pub fn set_treasury_float_cap_bp(
    ctx: Context<SetTreasuryFloatCapBp>,
    hub_float_cap_bp: u16,
) -> Result<()> {
    require!(
        hub_float_cap_bp as u64 <= BPS_DENOMINATOR,
        HubError::BpsOutOfRange
    );
    ctx.accounts.treasury_state.hub_float_cap_bp = hub_float_cap_bp;
    emit!(TreasuryFloatCapUpdated { hub_float_cap_bp });
    Ok(())
}

/// Migrates `TreasuryState.vault_wsol`/`vault_usdc` off the plain-keypair accounts
/// `mainnet-treasury-float.ts` created onto canonical Associated Token Accounts of the vault PDA.
/// Needed because Jupiter's `/swap/v2/build` always derives the swap's *source* token account as
/// the canonical ATA of `(taker, inputMint)` — there is no API parameter to override it — so
/// `finalize_epoch`'s hop1 (SOL/USDC → $HUB via Jupiter) can never succeed while `vault_wsol`/
/// `vault_usdc` are arbitrary keypair accounts. `vault_hub`/`treasury_float_vault` are untouched:
/// they are pure Jupiter *destination* accounts (overridable via `destinationTokenAccount`) and
/// share (owner, mint), which an ATA can't represent twice — no need for them to move.
///
/// Requires the currently-recorded vault to already be drained (balance == 0) before repointing,
/// so no balance is silently stranded at an address `TreasuryState` no longer references — the
/// caller must sweep first if either currently holds a nonzero balance. Skips that check for a
/// field still at `Pubkey::default()` (i.e. before `init_treasury_float` ever ran).
#[derive(Accounts)]
pub struct RepointTreasuryVaults<'info> {
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; must own the two new ATAs below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: must equal `treasury_state.vault_wsol` (verified in handler); read only to confirm
    /// it is drained before being superseded.
    pub old_vault_wsol: UncheckedAccount<'info>,
    /// CHECK: must equal `treasury_state.vault_usdc` (verified in handler); same as above.
    pub old_vault_usdc: UncheckedAccount<'info>,
    /// CHECK: new spl-token account, mint = native (WSOL), owner = vault (verified in handler) —
    /// must be the canonical ATA of (vault, WSOL_MINT), which the migration script derives
    /// off-chain; on-chain this only checks mint/owner, same as `init_treasury_float`.
    pub new_vault_wsol: UncheckedAccount<'info>,
    /// CHECK: new spl-token account, mint = config.usdc_mint, owner = vault (verified in
    /// handler) — must be the canonical ATA of (vault, config.usdc_mint).
    pub new_vault_usdc: UncheckedAccount<'info>,
}

pub fn repoint_treasury_vaults(ctx: Context<RepointTreasuryVaults>) -> Result<()> {
    let old_vault_wsol = ctx.accounts.treasury_state.vault_wsol;
    let old_vault_usdc = ctx.accounts.treasury_state.vault_usdc;
    require_keys_eq!(
        ctx.accounts.old_vault_wsol.key(),
        old_vault_wsol,
        HubError::InvalidTokenAccount
    );
    require_keys_eq!(
        ctx.accounts.old_vault_usdc.key(),
        old_vault_usdc,
        HubError::InvalidTokenAccount
    );
    if old_vault_wsol != Pubkey::default() {
        require!(
            read_token_amount(&ctx.accounts.old_vault_wsol)? == 0,
            HubError::VaultNotDrained
        );
    }
    if old_vault_usdc != Pubkey::default() {
        require!(
            read_token_amount(&ctx.accounts.old_vault_usdc)? == 0,
            HubError::VaultNotDrained
        );
    }

    require_token_account(&ctx.accounts.new_vault_wsol, &WSOL_MINT, ctx.accounts.vault.key)?;
    require_token_account(
        &ctx.accounts.new_vault_usdc,
        &ctx.accounts.config.usdc_mint,
        ctx.accounts.vault.key,
    )?;

    let new_vault_wsol = ctx.accounts.new_vault_wsol.key();
    let new_vault_usdc = ctx.accounts.new_vault_usdc.key();
    let ts = &mut ctx.accounts.treasury_state;
    ts.vault_wsol = new_vault_wsol;
    ts.vault_usdc = new_vault_usdc;

    emit!(TreasuryVaultsRepointed {
        old_vault_wsol,
        new_vault_wsol,
        old_vault_usdc,
        new_vault_usdc,
    });
    Ok(())
}
