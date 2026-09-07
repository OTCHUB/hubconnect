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

/// Metaplex Core program (desk NFTs are Core assets, §A2).
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// Core `Key::AssetV1` discriminator and `UpdateAuthority::Collection` tag.
pub const CORE_KEY_ASSET_V1: u8 = 1;
pub const CORE_UA_COLLECTION: u8 = 2;
/// Core `TransferV1` instruction discriminator.
pub const CORE_IX_TRANSFER_V1: u8 = 14;

#[constant]
pub const SEEDS_DOC: &str =
    "config|epoch+u64|tier+asset|consign+asset|accrual+wallet+u64|pot|burn|treasury|vault";
