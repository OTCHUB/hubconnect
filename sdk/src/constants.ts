// Mirror of programs/hub/src/constants.rs (Appendix, spec v1.2). Keep in sync.
export const BPS = 10_000;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const TIER_WEIGHTS_BP = [10_000, 12_500, 16_000, 20_000] as const;
export const TIER_WEIGHTS = TIER_WEIGHTS_BP.map((w) => w / BPS); // [1.00,1.25,1.60,2.00]
export const STEP_FEE_LAMPORTS = LAMPORTS_PER_SOL / 2;
export const OPS_PCT_BP = 1_000;
export const BURN_PCT_BP = 1_000;
export const EPOCH_HOURS = 24;

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

/** Cumulative step fee to reach `tier` from tier 0 (§A4). */
export const cumulativeFeeLamports = (tier: number) => STEP_FEE_LAMPORTS * tier;
