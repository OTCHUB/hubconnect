// Mirror of programs/hub/src/constants.rs (Appendix, spec v1.2). Keep in sync.
export const BPS = 10_000;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const TIER_WEIGHTS_BP = [10_000, 12_500, 16_000, 20_000] as const;
export const TIER_WEIGHTS = TIER_WEIGHTS_BP.map((w) => w / BPS); // [1.00,1.25,1.60,2.00]
export const STEP_FEE_LAMPORTS = LAMPORTS_PER_SOL / 2;
export const OPS_PCT_BP = 1_000;
export const BURN_PCT_BP = 1_000;
/** A round closes once its inflow reaches this (OTC desk-pot trigger: 0.1 SOL). */
export const MIN_POT_THRESHOLD_LAMPORTS = LAMPORTS_PER_SOL / 10;
/** Fixed-point scale of `Config.acc_per_weight` (lamports × ACC_SCALE per bp of weight). */
export const ACC_SCALE = 1_000_000_000_000n;

export const EXIT_DISCOUNT_BP = 1_000;
export const EXIT_HUB_LEG_BP = 5_000;
export const SWEEP_BUDGET_CAP_BP = 1_000;
export const SWEEP_PAYBACK_CAP_LAMPORTS = 4_200_000_000;
export const FLOOR_STALENESS_BP = 500;
export const CONSIGNMENT_ENABLED = true;
export const CONSIGNOR_SHARE_BP = 0;
export const LP_ENABLED = false;
export const LP_TARGET_SOL_LAMPORTS = 100 * LAMPORTS_PER_SOL;
export const TREASURY_HUB_FLOAT_CAP_BP = 200;

export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const HUB_PROGRAM_ID = "5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv";

/** Display names for tiers 1–4 (§A4): market-role ladder, not metals. */
export const TIER_NAMES = ["TRADER", "BROKER", "DEALER", "MARKET MAKER"] as const;

/** Cumulative step fee to reach `tier` from tier 0 (§A4). */
export const cumulativeFeeLamports = (tier: number) => STEP_FEE_LAMPORTS * tier;
/** Fee to move `from` → `to` (from = 0 is a fresh activation). */
export const stepFeeLamports = (from: number, to: number) => STEP_FEE_LAMPORTS * (to - from);
/** 90/10 split of a step fee. */
export const splitFee = (fee: number) => {
  const toOps = Math.floor((fee * OPS_PCT_BP) / BPS);
  return { toOps, toPot: fee - toOps };
};
