//! §B3 #4 finalize_epoch, #6 register_treasury_inflow.
//!
//! Rounds are threshold-gated, not clock-gated: `finalize_epoch` is callable the moment the open
//! epoch's inflow reaches `Config.min_pot_threshold_lamports` (OTC desk-pot semantics). §A5
//! 4-way split: 90% buys $OTC and is distributed pro-rata to activated desks (unchanged
//! mechanic — the $OTC leg's lamport-equivalent value is credited to `Config.acc_per_weight`
//! and its SOL earmarked in `OtcPotState.otc_pending_lamports` for `record_otc_buy`; `claim_yield`
//! pays desks in $OTC at the pot's lifetime average buy rate). The other 10% (5% burn / 2.5% LP
//! / 2.5% treasury) is swapped SOL→$HUB via a **two-hop** *synchronous* on-chain CPI executed
//! right here — WSOL→USDC (hop1, via Jupiter) then USDC→$HUB (hop2, via a **direct Raydium
//! CP-Swap `swap_base_input` CPI** — see `raydium_cpswap::swap_base_input`), routed through
//! `TreasuryState.vault_usdc` — best rate, real AMM volume/fees, no keeper-reimbursement
//! round-trip. Hop2 bypasses Jupiter entirely: Jupiter's Metis routing engine gates newly-created
//! pools out of "normal routing" on a liquidity-depth check (a $500/$1000 price-impact test)
//! regardless of the pool itself being real and swappable on-chain, which made the
//! keeper-owned/seeded HUB/USDC pool unroutable through Jupiter — calling Raydium's CP-Swap
//! program directly for hop2 sidesteps that off-chain gate. The two hops exist for a second
//! reason beyond moving the SOL: the realized USDC/HUB rate they observe (`usdc_received` from
//! hop1, `hub_received` from hop2) is how
//! `Config.tier_hub_cost_units_cached` gets refreshed — see the price-update block below and
//! `TIER_USD_COST_MICROS`/`PRICE_CLAMP_BP`/`PRICE_UPDATE_MIN_SOL_LAMPORTS`/`PRICE_STALENESS_SECS`.
//! The received $HUB (from hop2) splits 50/25/25 into: burned immediately; earmarked in
//! `TreasuryState.lp_pending_hub_units` for the phase-2 $HUB/$OTC LP; deposited into
//! `TreasuryState.treasury_float_vault` (buy-and-hold), capped at `hub_float_cap_bp` of supply
//! with any excess folded into the burn leg instead of left un-swapped.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::jupiter_swap;
use crate::instructions::otc_pay::{burn_checked, transfer_checked};
use crate::instructions::pot::*;
use crate::instructions::raydium_cpswap;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct FinalizeEpoch<'info> {
    /// Permissionless: the math is deterministic, so anyone may close a round once the
    /// threshold is met (they pay the next Epoch account's rent and assemble the Jupiter route).
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut, seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump = epoch.bump,
        constraint = !epoch.finalized @ HubError::EpochAlreadyFinalized
    )]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(
        init, payer = keeper, space = 8 + Epoch::INIT_SPACE,
        seeds = [SEED_EPOCH, &(epoch_index + 1).to_le_bytes()], bump
    )]
    pub next_epoch: Box<Account<'info, Epoch>>,
    /// CHECK: system-owned lamport vault PDA.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_BURN], bump = burn.bump)]
    pub burn: Box<Account<'info, BurnState>>,
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Box<Account<'info, OtcPotState>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Box<Account<'info, TreasuryState>>,
    /// CHECK: program-signed custody PDA; authority over `vault_wsol`/`vault_hub` below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked/TransferChecked.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: vault-owned WSOL scratch ATA, recorded on TreasuryState by `init_treasury_float`.
    #[account(mut, address = treasury_state.vault_wsol @ HubError::InvalidTokenAccount)]
    pub vault_wsol: UncheckedAccount<'info>,
    /// CHECK: vault-owned USDC scratch ATA — hop1's (WSOL→USDC) destination and hop2's
    /// (USDC→$HUB) source; the intermediate leg of the two-hop price-discovery swap.
    #[account(mut, address = treasury_state.vault_usdc @ HubError::InvalidTokenAccount)]
    pub vault_usdc: UncheckedAccount<'info>,
    /// CHECK: vault-owned $HUB scratch ATA — hop2's (USDC→$HUB) destination and
    /// `lp_pending_hub_units`'s physical custody.
    #[account(mut, address = treasury_state.vault_hub @ HubError::InvalidTokenAccount)]
    pub vault_hub: UncheckedAccount<'info>,
    /// CHECK: vault-owned $HUB buy-and-hold ATA, capped at `hub_float_cap_bp` of supply.
    #[account(mut, address = treasury_state.treasury_float_vault @ HubError::InvalidTokenAccount)]
    pub treasury_float_vault: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in the token-program helpers.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: pinned to `JUPITER_PROGRAM_ID` in `jupiter_swap::swap_exact_in`, used for hop1
    /// (WSOL→USDC) only — hop2 (USDC→$HUB) calls Raydium CP-Swap directly, see
    /// `raydium_cpswap::swap_base_input`.
    pub jupiter_program: UncheckedAccount<'info>,
    /// CHECK: pinned to `RAYDIUM_CP_SWAP_PROGRAM_ID` in `raydium_cpswap::swap_base_input`, used
    /// for hop2 (USDC→$HUB). Must be a distinct account from `jupiter_program` on real
    /// (non-`mock-jupiter`) builds so the runtime can resolve the hop2 CPI's target program.
    pub raydium_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_epoch<'info>(
    ctx: Context<'info, FinalizeEpoch<'info>>,
    epoch_index: u64,
    min_usdc_out: u64,
    min_hub_out: u64,
    hop1_account_count: u16,
    hop1_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let e = &mut ctx.accounts.epoch;
    require!(
        epoch_index == config.current_epoch,
        HubError::EpochNotCurrent
    );
    require!(
        ctx.accounts.treasury_state.vault_hub != Pubkey::default(),
        HubError::TreasuryFloatNotInitialized
    );

    // Whole lamports of dust re-enter the accumulator pool. `dust_scaled` has two sources —
    // round_credit's floor/ceiling slack, and §B3 #8 void_tier's forfeited pending — and *both*
    // are already-net-of-skim distributable SOL whose liability and `otc_pending_lamports` share
    // were booked once, at whichever past epoch originally produced the `credited` they're a
    // remainder/forfeiture of. Recycling them must only re-attribute *who* can claim that SOL
    // (redistribute it into `acc_per_weight` for currently-active desks) — it must NOT be treated
    // as fresh gross inflow: skimming it again into burn/lp/float would tax already-net money a
    // second time, and re-adding its `credited` share to `otc_pending_lamports` would double-count
    // an obligation that's been on the books since it was first credited (the fix below computes
    // `swap_total`/`burn`/`lp`/`float` from *this epoch's own fresh inflow only*, then folds
    // `carry` straight into the round's distributable pool after that split, and finally strips
    // `carry` back out of `credited` before adding to `otc_pending_lamports` so only the genuinely
    // new portion is counted).
    let carry = u64::try_from(config.dust_scaled / ACC_SCALE)
        .map_err(|_| error!(HubError::MathOverflow))?;
    config.dust_scaled %= ACC_SCALE;
    let fresh_inflow = e.inflow_lamports;
    e.inflow_lamports = add(fresh_inflow, carry)?;
    require!(
        e.inflow_lamports >= config.min_pot_threshold_lamports,
        HubError::PotBelowThreshold
    );

    // §A5 4-way split: 5% burn / 2.5% LP / 2.5% treasury-float (all three swapped SOL→$HUB in
    // one synchronous Jupiter CPI below) / 90% $OTC leg (credited through the accumulator,
    // unchanged mechanic). The skim applies to `fresh_inflow` only — `carry` already went through
    // this split (or never needed to, if it's the sub-lamport rounding remainder of a
    // distributable pool that was itself already net-of-skim) in whichever epoch produced it.
    let burn = bps_of(fresh_inflow, config.burn_pct_bp)?;
    let lp = bps_of(fresh_inflow, config.lp_pct_bp)?;
    let float = bps_of(fresh_inflow, config.treasury_float_pct_bp)?;
    let swap_total = add(add(burn, lp)?, float)?;
    let distributable_fresh = sub(fresh_inflow, swap_total)?;
    let pool = add(distributable_fresh, carry)?;
    let (per_w, credited, slack) = round_credit(pool, config.total_weight_bp)?;
    config.acc_per_weight = config
        .acc_per_weight
        .checked_add(per_w)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    add_dust(config, slack)?;

    e.total_weight_bp = config.total_weight_bp;
    e.burn_pending_lamports = burn;
    e.lp_pending_lamports = lp;
    e.treasury_float_lamports = float;
    e.distributed_lamports = credited;
    e.rolled_forward_lamports = sub(pool, credited)?;
    e.per_weight_scaled = per_w;
    e.acc_per_weight_after = config.acc_per_weight;
    e.finalized_ts = now;
    e.finalized = true;
    assert_epoch_balanced(e)?;

    // Only the fresh (not-yet-counted) slice of `credited` is new liability the keeper must buy
    // $OTC against; `carry`'s slice was already added to `otc_pending_lamports` when it was first
    // credited. `saturating_sub` is a defensive floor, not an expected branch: `credited` is
    // `pool` (== `distributable_fresh + carry`) minus a sub-lamport rounding remainder that's
    // always « 1 lamport, so `credited >= carry` in every practical case.
    let op = &mut ctx.accounts.otc_pot;
    op.otc_pending_lamports = add(op.otc_pending_lamports, credited.saturating_sub(carry))?;

    // Move `swap_total` lamports out of the pot now — it is spent immediately below, not left
    // pending for a keeper to draw later — and retire the matching slice of pot liability.
    if swap_total > 0 {
        pay_from_pot(
            &ctx.accounts.system_program,
            &ctx.accounts.pot,
            &ctx.accounts.vault_wsol.to_account_info(),
            config.pot_bump,
            swap_total,
        )?;
        config.pot_liability_lamports = sub(config.pot_liability_lamports, swap_total)?;
        jupiter_swap::sync_native(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.vault_wsol.to_account_info(),
        )?;

        let vault_bump = ctx.accounts.treasury_state.vault_bump;
        let vault_seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];

        // Split `remaining_accounts` at `hop1_account_count`: the first slice is hop1's
        // (WSOL→USDC) Jupiter route, assembled off-chain against a live quote so it clears at
        // the best available route; the remainder is hop2's (USDC→$HUB) fixed 13-account
        // Raydium CP-Swap `swap_base_input` account list (payer, authority, amm_config,
        // pool_state, input/output token accounts, input/output vaults, input/output token
        // programs, input/output mints, observation_state — see `raydium_cpswap::
        // swap_base_input`), which needs no off-chain-assembled instruction data since it's a
        // direct CPI, not a routed one.
        let hop1_count = hop1_account_count as usize;
        require!(
            hop1_count <= ctx.remaining_accounts.len(),
            HubError::HopAccountSplitOutOfRange
        );
        let (hop1_accounts, hop2_accounts) = ctx.remaining_accounts.split_at(hop1_count);

        let usdc_received = jupiter_swap::swap_exact_in(
            &ctx.accounts.jupiter_program.to_account_info(),
            hop1_accounts,
            hop1_data,
            &ctx.accounts.vault_usdc.to_account_info(),
            min_usdc_out,
            &[vault_seeds],
        )?;
        let hub_received = raydium_cpswap::swap_base_input(
            &ctx.accounts.raydium_program.to_account_info(),
            hop2_accounts,
            usdc_received,
            min_hub_out,
            &ctx.accounts.vault_hub.to_account_info(),
            &[vault_seeds],
        )?;

        // Split the received $HUB in the same proportion as the SOL legs that funded the swap
        // (burn : lp : float), so a future re-tune of the bp splits carries through automatically.
        let hub_burn =
            u64::try_from((hub_received as u128) * (burn as u128) / (swap_total as u128))
                .map_err(|_| error!(HubError::MathOverflow))?;
        let hub_lp = u64::try_from((hub_received as u128) * (lp as u128) / (swap_total as u128))
            .map_err(|_| error!(HubError::MathOverflow))?;
        // Float absorbs the floor-rounding remainder — mirrors the pot-leg dust pattern above.
        let hub_float_requested = sub(sub(hub_received, hub_burn)?, hub_lp)?;

        // Cap the treasury float at `hub_float_cap_bp` of supply; excess folds into the burn leg
        // instead of being left un-swapped or rejected.
        let cap_units = u64::try_from(
            (HUB_MAX_SUPPLY_UNITS as u128) * (ctx.accounts.treasury_state.hub_float_cap_bp as u128)
                / (BPS_DENOMINATOR as u128),
        )
        .map_err(|_| error!(HubError::MathOverflow))?;
        let room = cap_units.saturating_sub(ctx.accounts.treasury_state.treasury_float_units);
        let hub_float_deposited = hub_float_requested.min(room);
        let hub_float_excess = sub(hub_float_requested, hub_float_deposited)?;
        let hub_burn_total = add(hub_burn, hub_float_excess)?;

        if hub_burn_total > 0 {
            burn_checked(
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.vault_hub.to_account_info(),
                &ctx.accounts.hub_mint.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                hub_burn_total,
                &[vault_seeds],
            )?;
        }
        if hub_float_deposited > 0 {
            transfer_checked(
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.vault_hub.to_account_info(),
                &ctx.accounts.hub_mint.to_account_info(),
                &ctx.accounts.treasury_float_vault.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                hub_float_deposited,
                &[vault_seeds],
            )?;
        }

        let b = &mut ctx.accounts.burn;
        b.total_hub_burned = add(b.total_hub_burned, hub_burn_total)?;

        let ts = &mut ctx.accounts.treasury_state;
        ts.lp_pending_hub_units = add(ts.lp_pending_hub_units, hub_lp)?;
        ts.treasury_float_units = add(ts.treasury_float_units, hub_float_deposited)?;

        // Price refresh: hop1's `usdc_received` and hop2's `hub_received` give a realized
        // USDC/HUB rate for this round's swap. Only trust it if `swap_total` cleared the
        // eligibility gate (thin/keeper-controlled trades are skipped, not accepted at face
        // value) — see `PRICE_UPDATE_MIN_SOL_LAMPORTS`'s doc comment. Each tier's raw USD-target
        // equivalent is clamped by `clamp_tier_cost` (±`PRICE_CLAMP_BP` per round, bounded to
        // [`TIER_HUB_COST_FLOOR_BP`, 100%] of the `TIER_HUB_COST_UNITS` ceiling) before landing
        // in the cache `Config::hub_cost` reads from.
        let mut price_updated = false;
        if swap_total >= PRICE_UPDATE_MIN_SOL_LAMPORTS && usdc_received > 0 {
            let mut new_costs = config.tier_hub_cost_units_cached;
            for i in 0..TIER_COUNT {
                let raw = u64::try_from(
                    (config.tier_usd_cost_micros[i] as u128) * (hub_received as u128)
                        / (usdc_received as u128),
                )
                .map_err(|_| error!(HubError::MathOverflow))?;
                new_costs[i] = clamp_tier_cost(
                    config.tier_hub_cost_units_cached[i],
                    raw,
                    TIER_HUB_COST_UNITS[i],
                )?;
            }
            config.tier_hub_cost_units_cached = new_costs;
            config.last_price_update_ts = now;
            price_updated = true;
        }

        emit!(EpochSolSwapped {
            epoch: epoch_index,
            sol_swapped_lamports: swap_total,
            usdc_received,
            hub_received,
            hub_burned: hub_burn_total,
            hub_lp_earmarked: hub_lp,
            hub_float_requested,
            hub_float_deposited,
            treasury_float_units_after: ts.treasury_float_units,
            price_updated,
            tier_hub_cost_units_after: config.tier_hub_cost_units_cached,
            last_price_update_ts: config.last_price_update_ts,
        });
    }

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
        treasury_float_lamports: float,
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
    /// CHECK: `Config.protocol_fee_bp`'s skim destination — plain system account, matched by
    /// address so a caller cannot redirect the skim anywhere else.
    #[account(mut, address = config.ops_wallet @ HubError::Unauthorized)]
    pub ops_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Sources B/C/D/F: treasury moves `lamports` in, `bps_of(lamports, protocol_fee_bp)` is skimmed
/// straight to `ops_wallet` (§A5 revenue-model extension — see `PROTOCOL_FEE_BP`'s doc comment),
/// and only the remainder lands in the pot / is booked as epoch inflow.
pub fn register_treasury_inflow(
    ctx: Context<RegisterTreasuryInflow>,
    source: InflowSource,
    lamports: u64,
) -> Result<()> {
    require!(lamports > 0, HubError::ZeroAmount);
    let config = &mut ctx.accounts.config;
    let to_ops = bps_of(lamports, config.protocol_fee_bp)?;
    let to_pot = sub(lamports, to_ops)?;
    if to_ops > 0 {
        transfer_from_signer(
            &ctx.accounts.system_program,
            &ctx.accounts.treasury,
            &ctx.accounts.ops_wallet.to_account_info(),
            to_ops,
        )?;
    }
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.treasury,
        &ctx.accounts.pot,
        to_pot,
    )?;
    book_inflow(config, &mut ctx.accounts.epoch, to_pot)?;
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
        to_ops,
    });
    Ok(())
}
