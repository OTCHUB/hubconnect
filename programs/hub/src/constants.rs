//! Appendix constants — single source of truth (docs/hubconnect-spec.md v1.2).
//! Everything here is a *default* written into `Config` at `initialize_config`;
//! runtime behaviour reads `Config`, never these literals directly.

use anchor_lang::prelude::*;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// TIER_STEPS / WEIGHTS: 4 / [1.00, 1.25, 1.60, 2.00] — stored in basis points.
pub const TIER_COUNT: usize = 4;
pub const TIER_WEIGHTS_BP: [u16; TIER_COUNT] = [10_000, 12_500, 16_000, 20_000];

/// ACTIVATION_FEE = 0.5 SOL, paid FLAT once per `activate_tier` / `upgrade_tier` call (90% pot /
/// 10% ops) — independent of how many tier-steps the call crosses. A fresh activation into any
/// tier (T1..T4) pays this once; a later upgrade to a higher tier pays it again, once, regardless
/// of the size of the jump — never `(to - from) × fee`. (Named STEP_FEE for historical/layout
/// reasons; see `Config::step_fee`, which no longer scales with the step count.)
pub const STEP_FEE_LAMPORTS: u64 = LAMPORTS_PER_SOL / 2;
pub const OPS_PCT_BP: u16 = 1_000;

/// TIER_HUB_COST: $HUB base units required to reach each tier from scratch (cumulative table,
/// not incremental) — T1 100k, T2 125k, T3 150k, T4 200k. A fresh activation burns the full cost
/// of the target tier; a later upgrade burns only the difference from the tier it's already at
/// (never pays for the same $HUB twice). Burned via spl-token `BurnChecked` at the moment of
/// activation/upgrade, so every tier change permanently shrinks supply — independent of, and in
/// addition to, the round-based buyback burn (`record_burn`).
pub const TIER_HUB_COST_UNITS: [u64; TIER_COUNT] = [
    100_000 * HUB_UNIT,
    125_000 * HUB_UNIT,
    150_000 * HUB_UNIT,
    200_000 * HUB_UNIT,
];

/// Round split (§A5): 5% buys $HUB and burns it, 5% builds the $HUB/$OTC LP, the
/// remaining 90% buys $OTC and is distributed pro-rata to activated desks.
pub const BURN_PCT_BP: u16 = 500;
/// LP_BUILD_PCT = 5% of every pot inflow, earmarked for the $HUB/$OTC LP (phase-2 `build_lp`).
pub const LP_PCT_BP: u16 = 500;
/// Compile-time guard: the two fixed legs must never exceed 100% — `finalize_epoch` derives
/// the remaining OTC-buy leg as `inflow - burn - lp`, which would underflow-panic (or, worse,
/// silently misbehave if that subtraction were ever changed to an unchecked op) otherwise.
const _: () = assert!(
    (BURN_PCT_BP as u64) + (LP_PCT_BP as u64) <= BPS_DENOMINATOR,
    "round split (BURN_PCT_BP + LP_PCT_BP) exceeds 100%"
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
pub const LP_TARGET_SOL_LAMPORTS: u64 = 100 * LAMPORTS_PER_SOL;

/// TREASURY_HUB_FLOAT_CAP ≤ 2% of supply.
pub const TREASURY_HUB_FLOAT_CAP_BP: u16 = 200;

/// $OTC payment path (§A4.1): a step paid in $OTC costs the SOL step fee valued at the
/// authority-refreshed `otc_per_sol` rate × this premium (20_000 bp = 2.00×). The premium is
/// fixed at `init_otc_payments`; only the rate is refreshable.
pub const OTC_PREMIUM_BP: u16 = 20_000;
/// `activate_tier_otc` / `upgrade_tier_otc` reject a rate older than this (seconds).
pub const OTC_RATE_MAX_AGE_SECS: i64 = 86_400;

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

/// §A6.2 phase-2 lock+burn — Raydium CP-Swap (mainnet + devnet, same address). `deposit`
/// CPI accounts/order per Raydium's published IDL; `remaining_accounts` on `build_lp` are
/// passed through verbatim as the CPI's account list (client assembles them in IDL order),
/// mirroring the "adapter-specific, lands once the launch AMM is known" note this instruction
/// already carried — verify on devnet before mainnet, same discipline as every other external
/// program this contract touches.
pub const RAYDIUM_CP_SWAP_PROGRAM_ID: Pubkey = pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
/// Raydium's dedicated CP-Swap liquidity-locking program: burns the LP mint outright and mints
/// back a permanent fee-claim NFT to the caller — the "lock + burn, fees keep accruing, no rug"
/// primitive this flywheel's LP leg relies on.
pub const RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID: Pubkey =
    pubkey!("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");
/// Anchor sighash discriminators (`sha256("global:<ix>")[..8]`), verified independently —
/// not read from a vendored IDL, so no crate dependency is added for this integration.
pub const RAYDIUM_IX_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
pub const RAYDIUM_IX_LOCK_CP_LIQUIDITY: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];

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
/// OTC-launcher reward basket ($OTC, CRCLx, OpenAI, Anthropic) that funds desk-holder yield.
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

/// Classic SPL Token program ($OTC is a pump.fun mint, 6 decimals, Token-v1).
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// spl-token `TransferChecked` instruction discriminator.
pub const TOKEN_IX_TRANSFER_CHECKED: u8 = 12;
/// spl-token `BurnChecked` instruction discriminator.
pub const TOKEN_IX_BURN_CHECKED: u8 = 15;
/// spl-token `Account` length; `Mint.decimals` offset.
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
    "config|epoch+u64|tier+asset|pot|burn|otc_pot|creator_fee|treasury|vault|otc_pay|tokenomics|airdrop+asset|reward_round+u32|reward_claim+u32+asset";
