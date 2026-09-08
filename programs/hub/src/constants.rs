//! Appendix constants — single source of truth (docs/hubconnect-spec.md v1.2).
//! Everything here is a *default* written into `Config` at `initialize_config`;
//! runtime behaviour reads `Config`, never these literals directly.

use anchor_lang::prelude::*;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// TIER_STEPS / WEIGHTS: 4 / [1.00, 1.25, 1.60, 2.00] — stored in basis points.
pub const TIER_COUNT: usize = 4;
pub const TIER_WEIGHTS_BP: [u16; TIER_COUNT] = [10_000, 12_500, 16_000, 20_000];

/// STEP_FEE = 0.5 SOL per tier step (90% pot / 10% ops).
pub const STEP_FEE_LAMPORTS: u64 = LAMPORTS_PER_SOL / 2;
pub const OPS_PCT_BP: u16 = 1_000;

/// BUYBACK_BURN_PCT = 10% of every pot inflow.
pub const BURN_PCT_BP: u16 = 1_000;

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

/// CONSIGNMENT_ENABLED = true; CONSIGNOR_SHARE default 0% (A9.5).
pub const CONSIGNMENT_ENABLED: bool = true;
pub const CONSIGNOR_SHARE_BP: u16 = 0;

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

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_EPOCH: &[u8] = b"epoch";
pub const SEED_TIER: &[u8] = b"tier";
pub const SEED_CONSIGN: &[u8] = b"consign";
pub const SEED_ACCRUAL: &[u8] = b"accrual";
pub const SEED_POT: &[u8] = b"pot";
pub const SEED_BURN: &[u8] = b"burn";
pub const SEED_TREASURY: &[u8] = b"treasury";
/// Program-signed custody PDA that owns consigned desk assets (§A6.1).
pub const SEED_VAULT: &[u8] = b"vault";
/// $OTC payment parameters + POL reserve pointer (§A4.1).
pub const SEED_OTC_PAY: &[u8] = b"otc_pay";
/// Supply allocation plan + airdrop root (§A7.1); per-desk airdrop claim receipts.
pub const SEED_TOKENOMICS: &[u8] = b"tokenomics";
pub const SEED_AIRDROP: &[u8] = b"airdrop";

/// Classic SPL Token program ($OTC is a pump.fun mint, 6 decimals, Token-v1).
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// spl-token `TransferChecked` instruction discriminator.
pub const TOKEN_IX_TRANSFER_CHECKED: u8 = 12;
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
    "config|epoch+u64|tier+asset|consign+asset|accrual+wallet+u64|pot|burn|treasury|vault|otc_pay|tokenomics|airdrop+asset";
