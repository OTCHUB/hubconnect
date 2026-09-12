//! Appendix constants — single source of truth (docs/hubconnect-spec.md v1.2).
//! Everything here is a *default* written into `Config` at `initialize_config`;
//! runtime behaviour reads `Config`, never these literals directly.

use anchor_lang::prelude::*;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// TIER_STEPS / WEIGHTS: 4 / [1.00, 1.25, 1.60, 2.00] — stored in basis points.
pub const TIER_COUNT: usize = 4;
pub const TIER_WEIGHTS_BP: [u16; TIER_COUNT] = [10_000, 12_500, 16_000, 20_000];

/// Legacy flat ACTIVATION_FEE (0.5 SOL) — superseded by `TIER_STEP_FEE_LAMPORTS` below. Kept only
/// as the value `initialize_config` still writes into `Config.step_fee_lamports`, a dead-but-
/// byte-layout-stable field: `Config` is the already-initialized mainnet genesis account, and
/// removing or resizing a field in place would shift every later field's offset and break Borsh
/// deserialization of that live account. See `TIER_STEP_FEE_LAMPORTS`/`TierFeeConfig` (a new PDA,
/// same no-migration pattern as `OtcPotState`/`OtcPayConfig`) for the value actually charged.
pub const STEP_FEE_LAMPORTS: u64 = LAMPORTS_PER_SOL / 2;
/// TIER_STEP_FEE_LAMPORTS: ascending per-tier flat SOL fee (§A4, revised) — T1 0.2 SOL, T2 0.3
/// SOL, T3 0.4 SOL, T4 0.5 SOL. Paid once per `activate_tier` / `upgrade_tier` (or the $OTC-path
/// equivalents `activate_tier_otc` / `upgrade_tier_otc`) call, indexed by the *target* tier
/// reached (`to`) — never the tier being left (`from`) nor the number of steps crossed, so a
/// direct T1→T4 upgrade costs exactly T4's fee once, the same as a fresh T4 activation. Lives on
/// `TierFeeConfig` (`["tier_fee"]`), not `Config`, so it can be admin-retuned per tier
/// (`set_tier_step_fee`) without any `Config` layout migration. 90% pot / 10% ops, same split as
/// the old flat fee.
pub const TIER_STEP_FEE_LAMPORTS: [u64; TIER_COUNT] = [
    LAMPORTS_PER_SOL * 2 / 10, // T1 0.2 SOL
    LAMPORTS_PER_SOL * 3 / 10, // T2 0.3 SOL
    LAMPORTS_PER_SOL * 4 / 10, // T3 0.4 SOL
    LAMPORTS_PER_SOL * 5 / 10, // T4 0.5 SOL
];
pub const OPS_PCT_BP: u16 = 1_000;

/// Protocol-fee skim, taken at the source of *treasury-controlled* revenue only — never off the
/// desk-holder activation fee (that 10% is `OPS_PCT_BP` above, unchanged) — so operations funding
/// scales with what the treasury is actively harvesting (sweeps, exits, misc inflows, and the
/// MemeStock basket's converted yield) instead of trending to zero once most desks sit at T4 with
/// no more tier upgrades to sell. Applied in two places, both before the revenue becomes
/// staker/desk-holder yield:
///   - `register_treasury_inflow` (sources B/C/D/F): `bps_of(lamports, protocol_fee_bp)` routes to
///     `Config.ops_wallet` in SOL; only the remainder is booked as pot inflow.
///   - `fund_hub_pot` (MemeStock basket deposits): the same bp is skimmed per-mint into
///     `ops_wallet`'s ATA for that mint; only the remainder credits the bucket's pending balance.
///
/// Default 10% — matches the basket's carve-out described in §A5.1. Admin-retunable via
/// `update_config(ProtocolFeeBp, ...)`.
pub const PROTOCOL_FEE_BP: u16 = 1_000;

/// TIER_HUB_COST_UNITS: the genesis/ceiling $HUB table — T1 1,000,000 (1M), T2 1,250,000,
/// T3 1,500,000, T4 2,000,000. Raised 10x (from the original 100k/125k/150k/200k) once $HUB's
/// realized market price fell far enough below the original genesis assumption that the live,
/// price-derived cost (`clamp_tier_cost`'s `raw` input) was pinned at the *old* ceiling for every
/// tier — e.g. observed on 2026-09-12, epoch 0's realized swap rate implied a ~$50-equivalent T1
/// cost of ~1.74M $HUB, ~17.4x the old 100k ceiling. Two roles: (1) `Config.
/// tier_hub_cost_units_cached`'s starting value before any price update has ever landed (and its
/// stale-price fallback — see `PRICE_STALENESS_SECS`), and (2) the hard ceiling a live-priced
/// cost can never exceed, however low $HUB's market price goes. The *floor*
/// (`TIER_HUB_COST_FLOOR_BP` of this table) bounds the other direction. See
/// `TIER_USD_COST_MICROS` for the fixed USD target this table's token-unit equivalent tracks.
///
/// Raising this ceiling does not retroactively jump `tier_hub_cost_units_cached` on an
/// already-initialized `Config` — that cached value can only move by ±`PRICE_CLAMP_BP` (10%) per
/// price-eligible `finalize_epoch` round, in either direction, regardless of where the ceiling
/// sits. A cache pinned at the old 100k ceiling needs on the order of `log(10) / log(1.1)` ≈ 25
/// eligible rounds of sustained +10% moves to reach the new 1M ceiling, assuming the realized
/// price keeps calling for something at or above it the whole time.
pub const TIER_HUB_COST_UNITS: [u64; TIER_COUNT] = [
    1_000_000 * HUB_UNIT,
    1_250_000 * HUB_UNIT,
    1_500_000 * HUB_UNIT,
    2_000_000 * HUB_UNIT,
];

/// TIER_USD_COST_MICROS: the fixed USD target for each tier, in micro-USDC (6 decimals) —
/// $50/$60/$70/$80 cumulative. This never moves; what moves is how many $HUB tokens currently
/// equal it (`Config.tier_hub_cost_units_cached`), refreshed at `finalize_epoch` from a realized
/// two-hop Jupiter swap (WSOL→USDC→$HUB) — see `PRICE_CLAMP_BP`/`PRICE_UPDATE_MIN_SOL_LAMPORTS`/
/// `PRICE_STALENESS_SECS`. Same dollar cost for every activator regardless of when they show up;
/// only the token-unit burn size (and therefore the deflationary pressure) changes with price.
pub const TIER_USD_COST_MICROS: [u64; TIER_COUNT] =
    [50_000_000, 60_000_000, 70_000_000, 80_000_000];

/// A round's priced leg (`finalize_epoch`'s SOL input to the two-hop swap) must be at least this
/// large to be eligible to move the cached $HUB-per-tier cost — a thinner, keeper-controlled
/// trade is skipped (not trusted) rather than accepted at face value. Separate from, and larger
/// than, `MIN_POT_THRESHOLD_LAMPORTS` (a round can close and still not be price-eligible).
pub const PRICE_UPDATE_MIN_SOL_LAMPORTS: u64 = LAMPORTS_PER_SOL / 5; // 0.2 SOL

/// Symmetric clamp: an eligible round may move each tier's cached cost by at most this many bp,
/// in either direction, from its previous value — bounds the worst case a single sampled price
/// (sandwich, thin liquidity, etc.) can do to one round, regardless of how extreme the raw
/// observed rate is. Applied *in addition to* the floor/ceiling bound below.
pub const PRICE_CLAMP_BP: u16 = 1_000; // ±10% per eligible round

/// The cached cost may never shrink below this % of `TIER_HUB_COST_UNITS` (the genesis/ceiling
/// table) — a hard minimum-burn guarantee that holds no matter how high $HUB's real price climbs.
pub const TIER_HUB_COST_FLOOR_BP: u16 = 1_000; // 10% of ceiling

/// If the cached cost hasn't been refreshed by an eligible round in this long, `Config::hub_cost`
/// ignores the cache and falls back to the ceiling table instead — a hard stop against ever
/// trading off a price that's gone stale (e.g. the keeper stops calling `finalize_epoch`,
/// or every recent round has been below the eligibility gate).
pub const PRICE_STALENESS_SECS: i64 = 86_400; // 24h

/// Of every tier activation/upgrade's $HUB cost, this fraction is burned (`BurnChecked`,
/// permanent); the remainder is deposited into `TokenomicsConfig.treasury_lock_vault` as a
/// `reward_pending_units` credit — the same pro-rata-by-tier-weight mechanism
/// `fund_treasury_reward`/`open_reward_round`/`distribute_treasury_reward` already implements —
/// so it flows back to every active desk (diluted across Σw, including the activator) the next
/// time someone opens a reward round, instead of vanishing entirely into the burn.
pub const TIER_COST_BURN_BP: u16 = 5_000; // 50% burn / 50% → active-desk reward pool

/// Round split (§A5, 4-way): 90% buys $OTC and is distributed pro-rata to activated desks
/// (unchanged mechanic — accumulator-credited, keeper-reimbursed `record_otc_buy`); the other
/// 10% is swapped SOL→$HUB via a single synchronous on-chain Jupiter CPI executed inside
/// `finalize_epoch` itself (best rate, generates real AMM volume/fees), then the received $HUB
/// splits 50/25/25 (of that 10%, i.e. 5%/2.5%/2.5% of total inflow): burn / $HUB-$OTC LP-build
/// earmark / treasury float buy-and-hold.
pub const BURN_PCT_BP: u16 = 500;
/// LP_BUILD_PCT = 2.5% of every pot inflow, swapped to $HUB and earmarked (as
/// `TreasuryState.lp_pending_hub_units`) for the $HUB/$OTC LP (phase-2 `build_lp_otc_locked`).
pub const LP_PCT_BP: u16 = 250;
/// TREASURY_FLOAT_PCT = 2.5% of every pot inflow, swapped to $HUB and deposited into
/// `TreasuryState.treasury_float_vault` (buy-and-hold), capped at `hub_float_cap_bp` of supply —
/// excess is burned instead of deposited, never left un-swapped.
pub const TREASURY_FLOAT_PCT_BP: u16 = 250;
/// Compile-time guard: the three fixed legs must never exceed 100% — `finalize_epoch` derives
/// the remaining OTC-buy (distributable) leg as `inflow - burn - lp - treasury_float`, which
/// would underflow-panic (or, worse, silently misbehave if that subtraction were ever changed to
/// an unchecked op) otherwise.
const _: () = assert!(
    (BURN_PCT_BP as u64) + (LP_PCT_BP as u64) + (TREASURY_FLOAT_PCT_BP as u64) <= BPS_DENOMINATOR,
    "round split (BURN_PCT_BP + LP_PCT_BP + TREASURY_FLOAT_PCT_BP) exceeds 100%"
);

/// MIN_POT_THRESHOLD = 0.1 SOL. A round (epoch) closes as soon as its inflow reaches this —
/// the same trigger the OTC desk pot uses ("the moment the pot clears 0.1 SOL it is spent").
pub const MIN_POT_THRESHOLD_LAMPORTS: u64 = LAMPORTS_PER_SOL / 10;

/// Fixed-point scale for `Config.acc_per_weight` (lamports × ACC_SCALE per bp of weight).
/// u128 headroom: distributable ≤ 2⁶⁴ × 10¹² / Σw(≥10⁴) ≈ 10²⁷ per round.
pub const ACC_SCALE: u128 = 1_000_000_000_000;

/// EXIT_DISCOUNT 10% off live floor / HUB leg 50% burned / SOL leg 50% → pot.
pub const EXIT_DISCOUNT_BP: u16 = 1_000;
pub const EXIT_HUB_LEG_BP: u16 = 5_000;

/// SWEEP_BUDGET_CAP = 10% of treasury SOL per desk.
pub const SWEEP_BUDGET_CAP_BP: u16 = 1_000;
/// SWEEP_PAYBACK_CAP ≤ 60 desk-days at D = 0.07 SOL ≈ 4.2 SOL/desk.
pub const SWEEP_PAYBACK_CAP_LAMPORTS: u64 = 4_200_000_000;

/// FLOOR_STALENESS_GUARD = 5%.
pub const FLOOR_STALENESS_BP: u16 = 500;

/// LP_TARGET_SOL_DEPTH reference ceiling 100–200 SOL-side; default lower bound.
pub const LP_ENABLED: bool = false;
/// No longer a compounding cap (removed — see `treasury::compound_lp_otc`'s doc comment: locked
/// LP is a one-way, permanent position that only ever grows, either from `finalize_epoch`'s
/// earmark or from harvested fee yield, so there is nothing to cap or burn-excess). Retained only
/// as a legacy, currently-unused `Config`/`ConfigField` slot so existing devnet deployments and
/// the on-chain account layout don't need a migration; a future use may repurpose it.
pub const LP_TARGET_SOL_LAMPORTS: u64 = 100 * LAMPORTS_PER_SOL;
/// Dust floor for the LP compounders (`compound_lp_otc` and the basket `compound_lp_basket`): a
/// permissionless call is refused until the pair's pending $HUB earmark clears this, so a keeper
/// never burns a Raydium CPI's compute budget/rent compounding a few thousand base units. 100 $HUB.
pub const LP_COMPOUND_MIN_HUB_UNITS: u64 = 100 * HUB_UNIT;

/// TREASURY_HUB_FLOAT_CAP ≤ 5% of supply (experimental parameter; admin-updatable via
/// `set_treasury_float_cap_bp` — the treasury multisig may retune while iterating). Excess
/// beyond the live cap at deposit time is burned instead of floated.
pub const TREASURY_HUB_FLOAT_CAP_BP: u16 = 500;

/// $OTC payment path (§A4.1, revised): `activate_tier_otc` / `upgrade_tier_otc` charge the same
/// ascending per-tier SOL fee as the SOL path (T1 0.2 / T2 0.3 / T3 0.4 / T4 0.5 SOL; 90% pot /
/// 10% ops, `book_inflow`'d into the same epoch — see `TierFeeConfig`/`TIER_STEP_FEE_LAMPORTS`)
/// *plus* an $OTC-denominated premium that replaces the tier's
/// direct $HUB burn. The premium is no longer priced off a static authority-refreshed rate —
/// it's a real synchronous on-chain Jupiter OTC→$HUB swap, so it's dynamic as $HUB's market price
/// moves. Caller (payer/keeper) supplies `otc_swap_amount`, the $OTC input for the swap leg
/// (sized off-chain via a live Jupiter quote so the swap clears at least `hub_cost_delta` $HUB —
/// enforced on-chain as the swap's `min_out` floor, trustlessly, via balance-delta). An equal
/// $OTC amount is charged again into `OtcPotState.otc_vault` (desk-pot leg, no swap — raises
/// `total_otc_bought_units`, lifting the lifetime average buy rate `claim_yield` prices every
/// desk's yield at), so the total $OTC charged is ~2× the swap leg's cost — the "2× premium" —
/// while the received $HUB from the swap leg is burned in full, shrinking supply.
pub const OTC_PAY_SWAP_BURN_PCT_BP: u16 = 5_000;

/// Native mint (wrapped SOL) — Jupiter routes SOL legs through a WSOL token account; this
/// program wraps by a plain System transfer into a persistent vault-owned WSOL ATA followed by
/// spl-token `SyncNative`.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// spl-token `SyncNative` instruction discriminator.
pub const TOKEN_IX_SYNC_NATIVE: u8 = 17;

/// Jupiter aggregator v6 — real on-chain SOL→$HUB (round split, `finalize_epoch`) and
/// OTC→$HUB (2× premium swap-burn leg, `otc_pay.rs`) swaps, so both legs clear at the live
/// market rate and generate genuine AMM volume/fees instead of a keeper-attested off-chain buy.
/// Jupiter has no fixed per-instruction account list (the router picks a different combination
/// of AMMs/hops per quote), so — mirroring `raydium_cpswap.rs`'s trust model — the caller
/// assembles the route's accounts/data off-chain via Jupiter's quote + swap-instructions API and
/// supplies them verbatim; this program only pins this program id and enforces `min_out` via a
/// balance-delta check on the destination token account (`jupiter_swap::swap_exact_in`).
///
/// Jupiter v6 is mainnet-beta-only — it does not exist on devnet, and a devnet fork of it (this
/// program's own localnet validator forks mainnet-beta for exactly that reason, see Anchor.toml)
/// still needs real, liquid mainnet routes to actually swap, which $HUB/$OTC do not have yet.
/// `mock-jupiter` swaps this constant for `programs/mock_jupiter`'s program id instead — a
/// same-interface stand-in deployed to devnet with a pre-funded liquidity reserve — so
/// `finalize_epoch` / `activate_tier_otc` / `upgrade_tier_otc` can be exercised end-to-end on
/// devnet without live $HUB/$OTC liquidity. Every other build (default, `verify.yml`, every
/// mainnet-beta deploy) keeps the real Jupiter id below; this feature must never ship to mainnet.
#[cfg(not(feature = "mock-jupiter"))]
pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
#[cfg(feature = "mock-jupiter")]
pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("BvjZ2YNTxKmKKKWUiNNRG83tQr5djiMMPBAGJxiZZn5C");

/// §A6.3 second flywheel — the treasury's pro-rata claim on the OTC launcher's 70%
/// holders-in-stock leg (it holds 2% of $HUB supply per §A7.1), already denominated in $OTC.
/// Re-split 80/5/5/5/5 every time the batch clears: 80% is a direct, swap-free injection into
/// `OtcPotState` (raises the lifetime average buy rate for every desk); the other four 5% legs
/// each require an off-chain swap the keeper performs before attesting the result on-chain.
pub const CREATOR_FEE_DESK_POT_BP: u16 = 8_000;
pub const CREATOR_FEE_BURN_BP: u16 = 500;
/// LP leg: half swapped $OTC→$HUB, half kept as $OTC, both deposited into the HUB/OTC pool.
pub const CREATOR_FEE_LP_BP: u16 = 500;
pub const CREATOR_FEE_STACK_BP: u16 = 500;
pub const CREATOR_FEE_OPS_BP: u16 = 500;
/// Default clearing threshold: 1,000 $OTC (assumes the pump.fun-standard 6 decimals; the
/// authority may retune via `init_creator_fee_state`'s arg — this is only the launch default).
pub const CREATOR_FEE_CLEAR_THRESHOLD_UNITS: u64 = 1_000 * 1_000_000;
/// Compile-time guard: `clear_creator_fees` derives the desk-pot leg as the remainder after
/// subtracting the other four (`cleared - burn - lp - stack - ops`) — this must sum to exactly
/// 100% or that remainder silently drifts from the intended 80% desk-pot share.
const _: () = assert!(
    (CREATOR_FEE_DESK_POT_BP as u64)
        + (CREATOR_FEE_BURN_BP as u64)
        + (CREATOR_FEE_LP_BP as u64)
        + (CREATOR_FEE_STACK_BP as u64)
        + (CREATOR_FEE_OPS_BP as u64)
        == BPS_DENOMINATOR,
    "creator-fee split (desk_pot + burn + lp + stack + ops) must sum to exactly 100%"
);

/// §A6.2 phase-2 lock+burn AND `finalize_epoch`'s hop2 (USDC→$HUB) — Raydium CP-Swap (mainnet +
/// devnet, same address). `deposit`/`swap_base_input` CPI accounts/order per Raydium's published
/// IDL; `remaining_accounts` are passed through verbatim as the CPI's account list (client
/// assembles them in IDL order), mirroring the "adapter-specific, lands once the launch AMM is
/// known" note `build_lp` already carried — verify on devnet before mainnet, same discipline as
/// every other external program this contract touches.
///
/// `mock-jupiter` swaps this constant for `programs/mock_jupiter`'s program id instead, exactly
/// like `JUPITER_PROGRAM_ID` above — that crate's `swap_base_input` instruction is named to match
/// so Anchor's own discriminator hash lands on the same 8 bytes as `RAYDIUM_IX_SWAP_BASE_INPUT`
/// below, needing no dispatch table. `build_lp`/`build_lp_basket_locked` never reach this target
/// in any existing localnet test (all gated/negative cases, see `tests/m3-treasury.ts`), so this
/// only actually changes behavior for `finalize_epoch`'s hop2.
#[cfg(not(feature = "mock-jupiter"))]
pub const RAYDIUM_CP_SWAP_PROGRAM_ID: Pubkey =
    pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
#[cfg(feature = "mock-jupiter")]
pub const RAYDIUM_CP_SWAP_PROGRAM_ID: Pubkey = pubkey!("BvjZ2YNTxKmKKKWUiNNRG83tQr5djiMMPBAGJxiZZn5C");
/// Raydium's dedicated CP-Swap liquidity-locking program: burns the LP mint outright and mints
/// back a permanent fee-claim NFT to the caller — the "lock + burn, fees keep accruing, no rug"
/// primitive this flywheel's LP leg relies on.
pub const RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID: Pubkey =
    pubkey!("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");
/// Anchor sighash discriminators (`sha256("global:<ix>")[..8]`), verified independently —
/// not read from a vendored IDL, so no crate dependency is added for this integration.
pub const RAYDIUM_IX_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
pub const RAYDIUM_IX_LOCK_CP_LIQUIDITY: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];
/// `finalize_epoch`'s hop2 (USDC→$HUB) direct-CPI leg — bypasses Jupiter's Metis routing engine,
/// which gates newly-created/thin pools out of "normal routing" regardless of on-chain liquidity
/// being real (see `epochs.rs`'s `finalize_epoch` doc comment). `sha256("global:swap_base_input")
/// [..8]`.
pub const RAYDIUM_IX_SWAP_BASE_INPUT: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];
/// Locking program's `collect_cp_fees` — harvests the fee-claim NFT's accrued CP-Swap trading
/// fees straight into the caller-supplied recipient token accounts (no args). This is the yield
/// leg of the "lock forever, keep claiming fees" primitive: the deposited LP itself never moves
/// again, but whoever holds the fee-claim NFT (the treasury vault PDA, see `lock_cp_liquidity`
/// above) may harvest it indefinitely. `sha256("global:collect_cp_fees")[..8]`.
pub const RAYDIUM_IX_COLLECT_CP_FEES: [u8; 8] = [8, 30, 51, 199, 209, 184, 247, 133];

/// §A7.1 supply plan. $HUB is minted once: 1,000,000,000 × 10⁶ base units (§A3.1 / §A7).
pub const HUB_DECIMALS: u8 = 6;
pub const HUB_UNIT: u64 = 1_000_000;
pub const HUB_MAX_SUPPLY: u64 = 1_000_000_000;
pub const HUB_MAX_SUPPLY_UNITS: u64 = HUB_MAX_SUPPLY * HUB_UNIT;
/// Snapshot airdrop: 10,000 $HUB per desk asset that exists in `Config.desk_collection` at
/// the snapshot. Total = desks × this; the share of supply follows from the desk count.
pub const AIRDROP_PER_DESK: u64 = 10_000;
pub const AIRDROP_PER_DESK_UNITS: u64 = AIRDROP_PER_DESK * HUB_UNIT;
/// Yield reserve: 2% of MAX_SUPPLY held by the treasury multisig (never sold), backing the
/// OTC-launcher reward basket ($OTC, CRCLx, NVDAx, SPCXx) that funds desk-holder yield.
pub const YIELD_RESERVE_BP: u16 = 200;
/// LP reserve: 0.5% of MAX_SUPPLY held by the treasury multisig (never sold) so the launched
/// coin can seed/deepen its own liquidity position.
pub const LP_RESERVE_BP: u16 = 50;
/// Treasury lock: yield reserve + LP reserve = 2.5% of MAX_SUPPLY held by the treasury
/// multisig (never sold). Combined with the desk airdrop (up to 2.5% at the 2,500-desk cap)
/// this is the 5% total treasury allocation; the remaining ≥95% is public, bought up the OTC
/// launch curve.
pub const TREASURY_LOCK_BP: u16 = YIELD_RESERVE_BP + LP_RESERVE_BP;
/// Dev / team allocation at launch: none. Everything not airdropped or treasury-locked is
/// public — bought up the OTC launch curve.
pub const TEAM_ALLOCATION_BP: u16 = 0;
/// Domain tag for airdrop Merkle leaves: `keccak(tag ‖ asset ‖ amount_le)`.
pub const AIRDROP_LEAF_TAG: &[u8] = b"hub-airdrop-v1";
/// Hard cap on `set_airdrop_root`'s `desk_count`: the launch policy caps the snapshot airdrop at
/// the first 2,500 desks (§A7.1), and `TokenomicsConfig::apply_snapshot` derives `airdrop_bp`
/// straight from `desk_count` — without an on-chain ceiling a snapshot could silently eat into
/// the public/team share past the intended 2.5%. Multiple snapshot rounds are still supported:
/// `set_airdrop_root` may raise `desk_count` in a later call (never lower it once claims have
/// started) to onboard desks minted after an earlier round, up to this cap.
pub const AIRDROP_DESK_CAP: u32 = 2_500;

/// §A6.3/§A7.1 bridge — `treasury_lock_vault` (holding the immutable 2% genesis floor) is also
/// the landing account for `fund_treasury_reward` deposits: $HUB swapped off-chain from the OTC
/// launcher's holders-in-stock reward leg (same source as `CreatorFeeState`'s `Stack` leg, but
/// routed here instead of the ordinary treasury float). `open_reward_round` snapshots the pending
/// deposit across the live Σw of active desks into a `RewardRound`; `distribute_treasury_reward`
/// then pays each active desk its tier-weighted share, exactly once per round.
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_EPOCH: &[u8] = b"epoch";
pub const SEED_TIER: &[u8] = b"tier";
pub const SEED_POT: &[u8] = b"pot";
pub const SEED_BURN: &[u8] = b"burn";
/// $OTC yield-vault bookkeeping (§A5): otc_pending_lamports budget + lifetime avg buy rate.
pub const SEED_OTC_POT: &[u8] = b"otc_pot";
/// Ascending per-tier `activate_tier`/`upgrade_tier` SOL fee (§A4, revised) — see
/// `TIER_STEP_FEE_LAMPORTS`/`TierFeeConfig`.
pub const SEED_TIER_FEE: &[u8] = b"tier_fee";
/// §A6.3 creator-fee flywheel bookkeeping: pending $OTC + per-leg earmarks.
pub const SEED_CREATOR_FEE: &[u8] = b"creator_fee";
pub const SEED_TREASURY: &[u8] = b"treasury";
/// Program-signed custody PDA for treasury-side token positions (e.g. LP tokens, §A6.2).
pub const SEED_VAULT: &[u8] = b"vault";
/// $OTC payment parameters + POL reserve pointer (§A4.1).
pub const SEED_OTC_PAY: &[u8] = b"otc_pay";
/// Supply allocation plan + airdrop root (§A7.1); per-desk airdrop claim receipts.
pub const SEED_TOKENOMICS: &[u8] = b"tokenomics";
pub const SEED_AIRDROP: &[u8] = b"airdrop";
/// `["reward_round", index]` — one `fund_treasury_reward` snapshot, split across active desks.
pub const SEED_REWARD_ROUND: &[u8] = b"reward_round";
/// `["reward_claim", round_index, asset]` — one payout per desk asset per reward round.
pub const SEED_REWARD_CLAIM: &[u8] = b"reward_claim";
/// §A5.1 MemeStock basket bookkeeping — the treasury's converted source-B (13-stock) desk yield.
pub const SEED_HUB_POT: &[u8] = b"hub_pot";
/// `["hub_pot_round", index]` — one `fund_hub_pot` snapshot (all 4 buckets), split across
/// active desks, mirrors `SEED_REWARD_ROUND`.
pub const SEED_HUB_POT_ROUND: &[u8] = b"hub_pot_round";
/// `["hub_pot_claim", round_index, asset]` — one payout per desk asset per HUB Pot round.
pub const SEED_HUB_POT_CLAIM: &[u8] = b"hub_pot_claim";

/// Classic SPL Token program. WSOL and USDC are classic Token-v1 mints — the two-hop price
/// leg's `vault_wsol`/`vault_usdc` legs (`sync_native`, hop1's Jupiter route) only ever touch
/// this program. Devnet/localnet's test-fixture $HUB mint is also classic Token-v1 (see
/// `scripts/devnet-hub-mint.ts`/`tests/harness.ts`'s `createSplMint`), but mainnet's real $HUB
/// mint is Token-2022 — see `TOKEN_2022_PROGRAM_ID` below, never assume $HUB implies this one.
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// Token-2022 (Token Extensions) program. $OTC and the whole MemeStock basket (CRCLx/NVDAx/
/// SPCXx xStock RWA mints) are issued as Token-2022, not classic Token-v1. Mainnet's real $HUB
/// mint is *also* Token-2022 (devnet/localnet's test-fixture $HUB mint is classic Token-v1
/// instead — the two environments intentionally differ here, see `TOKEN_PROGRAM_ID` above).
/// Every helper in `otc_pay.rs` that moves or reads a mint's accounts must accept either
/// program, dispatching the CPI to whichever one the account is actually owned by (never
/// hardcoded) — and every `Accounts` struct that could touch both a classic-Token mint and
/// $HUB/$OTC/basket in the *same instruction* (e.g. `epochs::FinalizeEpoch`) needs distinct
/// `token_program`/`hub_token_program`-style fields, since a single field can't be both.
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/// spl-token / Token-2022 `TransferChecked` instruction discriminator (identical byte in both
/// programs — Token-2022 is wire-compatible with classic Token for every base instruction).
pub const TOKEN_IX_TRANSFER_CHECKED: u8 = 12;
/// spl-token / Token-2022 `BurnChecked` instruction discriminator.
pub const TOKEN_IX_BURN_CHECKED: u8 = 15;
/// spl-token `Account` length (Token-2022's base layout is identical for the first 165 bytes;
/// an account with extensions is longer, never shorter — callers must compare with `>=`, not
/// `==`). `Mint.decimals` offset — likewise a fixed prefix shared by both programs.
pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const MINT_DECIMALS_OFFSET: usize = 44;

/// Metaplex Core program (desk NFTs are Core assets, §A2).
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// Core `Key::AssetV1` discriminator and `UpdateAuthority::Collection` tag.
pub const CORE_KEY_ASSET_V1: u8 = 1;
pub const CORE_UA_COLLECTION: u8 = 2;
/// Core `TransferV1` instruction discriminator.
pub const CORE_IX_TRANSFER_V1: u8 = 14;

#[constant]
pub const SEEDS_DOC: &str =
    "config|epoch+u64|tier+asset|pot|burn|otc_pot|creator_fee|treasury|vault|otc_pay|tokenomics|airdrop+asset|reward_round+u32|reward_claim+u32+asset|hub_pot|hub_pot_round+u32|hub_pot_claim+u32+asset";
