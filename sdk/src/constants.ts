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

/** §A4.1 $OTC payment path: SOL step-fee value at `otc_per_sol` × this premium (2.00×). */
export const OTC_PREMIUM_BP = 20_000;
/** `activate_tier_otc` / `upgrade_tier_otc` reject an `otc_per_sol` older than this. */
export const OTC_RATE_MAX_AGE_SECS = 86_400;

export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const HUB_PROGRAM_ID = "5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/**
 * $HUB token: fixed 1,000,000,000 supply minted once at launch, mint authority revoked
 * (scripts/hub-authority.ts). No emissions — supply only moves down via buyback-burn.
 */
export const HUB_DECIMALS = 6;
export const HUB_MAX_SUPPLY = 1_000_000_000;
export const HUB_MAX_SUPPLY_UNITS = BigInt(HUB_MAX_SUPPLY) * 10n ** BigInt(HUB_DECIMALS);

export type SupplyBreakdown = {
  maxUnits: bigint;
  burnedUnits: bigint;
  /** Treasury multisig float + program vault custody + LP-deposited $HUB (§A3.1, ≤2% cap). */
  lockedUnits: bigint;
  circulatingUnits: bigint;
  /** burned / circulating, in bp (null when nothing circulates). */
  burnPctOfCirculatingBp: number | null;
  /** burned / max supply, in bp. */
  burnPctOfMaxBp: number;
};

const clampNonNeg = (v: bigint) => (v < 0n ? 0n : v);

/** Circulating = max − burned − treasury/locked; ratios in bp, computed in bigint. */
export function supplyBreakdown(
  burnedUnits: bigint,
  lockedUnits: bigint,
  maxUnits: bigint = HUB_MAX_SUPPLY_UNITS,
): SupplyBreakdown {
  const burned = clampNonNeg(burnedUnits > maxUnits ? maxUnits : burnedUnits);
  const locked = clampNonNeg(lockedUnits);
  const circulating = clampNonNeg(maxUnits - burned - locked);
  return {
    maxUnits,
    burnedUnits: burned,
    lockedUnits: locked,
    circulatingUnits: circulating,
    burnPctOfCirculatingBp: circulating > 0n ? Number((burned * BigInt(BPS)) / circulating) : null,
    burnPctOfMaxBp: maxUnits > 0n ? Number((burned * BigInt(BPS)) / maxUnits) : 0,
  };
}

/**
 * §A7.1 supply plan — mirrors `TokenomicsConfig` defaults. Airdrop = 10,000 $HUB per desk asset
 * at snapshot; treasury lock 5% (held, never sold — creator-fee position); team 0%; everything
 * else is public, bought up the OTC launch curve.
 */
export const AIRDROP_PER_DESK = 10_000;
export const AIRDROP_PER_DESK_UNITS = BigInt(AIRDROP_PER_DESK) * 10n ** BigInt(HUB_DECIMALS);
/**
 * Launch policy cap, not a program constant: `apply_snapshot(desk_count)` accepts whatever
 * `desk_count` the snapshot script passes in, so the cap is enforced by only including the
 * first 2,500 desks activated on otcdesks.cash (by activation order) in the Merkle tree passed
 * to `publish_airdrop_root`. Kept here so the preview math and UI agree with that policy before
 * the real snapshot is taken.
 */
export const AIRDROP_DESK_CAP = 2_500;
/** Yield reserve: 2% of supply backing the OTC-launcher reward basket ($OTC, CRCLx, OpenAI, Anthropic). */
export const YIELD_RESERVE_BP = 200;
/** LP reserve: 0.5% of supply held to seed/deepen the launched coin's own liquidity. */
export const LP_RESERVE_BP = 50;
/** Treasury lock = yield reserve + LP reserve = 2.5%; + desk airdrop (≤2.5% at cap) = 5% total. */
export const TREASURY_LOCK_BP = YIELD_RESERVE_BP + LP_RESERVE_BP;
export const TEAM_ALLOCATION_BP = 0;
/** Domain tag for airdrop Merkle leaves: `sha256(tag ‖ asset ‖ amount_le)`. */
export const AIRDROP_LEAF_TAG = "hub-airdrop-v1";

export type AllocationSlice = {
  /** Stable id: `airdrop` · `yield` · `lp` · `team` · `public`. */
  id: "airdrop" | "yield" | "lp" | "team" | "public";
  label: string;
  units: bigint;
  /** Share of max supply in bp (floored, matches on-chain `*_bp`). */
  bp: number;
};

export type TokenomicsPlan = {
  maxUnits: bigint;
  deskCount: number;
  airdropPerDeskUnits: bigint;
  /** Desks the airdrop pool is actually sized on: `min(deskCount, airdropDeskCap)`. */
  airdropEligibleDeskCount: number;
  /** Policy cap on airdrop-eligible desks (§A7.1 launch policy, `AIRDROP_DESK_CAP`). */
  airdropDeskCap: number;
  /** True when `deskCount` has grown past `airdropDeskCap` — later desks earn no airdrop. */
  airdropCapped: boolean;
  slices: AllocationSlice[];
  airdropUnits: bigint;
  /** Yield reserve + LP reserve (the on-chain `treasury_lock_bp` lock, 2.5% of supply). */
  treasuryLockUnits: bigint;
  yieldReserveUnits: bigint;
  lpUnits: bigint;
  teamUnits: bigint;
  publicUnits: bigint;
  /** True when airdrop + treasury + team would exceed max supply (the program rejects this). */
  overAllocated: boolean;
};

/**
 * Pure mirror of `TokenomicsConfig::apply_snapshot` — used before the PDA exists (preview from
 * the live desk count) and to cross-check the on-chain numbers afterwards. Also applies the
 * `AIRDROP_DESK_CAP` launch policy: only the first `airdropDeskCap` desks activated on
 * otcdesks.cash before the snapshot are eligible, regardless of how large the collection grows.
 */
export function tokenomicsPlan(
  deskCount: number,
  opts: {
    maxUnits?: bigint;
    airdropPerDeskUnits?: bigint;
    treasuryLockBp?: number;
    teamBp?: number;
    airdropDeskCap?: number;
  } = {},
): TokenomicsPlan {
  const maxUnits = opts.maxUnits ?? HUB_MAX_SUPPLY_UNITS;
  const perDesk = opts.airdropPerDeskUnits ?? AIRDROP_PER_DESK_UNITS;
  const treasuryLockBp = opts.treasuryLockBp ?? TREASURY_LOCK_BP;
  const teamBp = opts.teamBp ?? TEAM_ALLOCATION_BP;
  const airdropDeskCap = opts.airdropDeskCap ?? AIRDROP_DESK_CAP;
  const bps = BigInt(BPS);
  const clampedDeskCount = Math.max(0, Math.floor(deskCount));
  const airdropEligibleDeskCount = Math.min(clampedDeskCount, airdropDeskCap);
  const airdropCapped = clampedDeskCount > airdropDeskCap;
  const airdropUnits = BigInt(airdropEligibleDeskCount) * perDesk;
  // The on-chain plan only records a single combined `treasury_lock_bp`; split it back into the
  // yield-reserve / LP sub-shares using the fixed launch ratio (200:50) so the UI can show both
  // even when `treasuryLockBp` came from `TokenomicsView` instead of the local constants.
  const yieldReserveBp = Math.round((treasuryLockBp * YIELD_RESERVE_BP) / TREASURY_LOCK_BP);
  const lpBp = treasuryLockBp - yieldReserveBp;
  const yieldReserveUnits = (maxUnits * BigInt(yieldReserveBp)) / bps;
  const lpUnits = (maxUnits * BigInt(lpBp)) / bps;
  const treasuryLockUnits = yieldReserveUnits + lpUnits;
  const teamUnits = (maxUnits * BigInt(teamBp)) / bps;
  const carved = airdropUnits + treasuryLockUnits + teamUnits;
  const overAllocated = carved > maxUnits;
  const publicUnits = overAllocated ? 0n : maxUnits - carved;
  const airdropBp = Number((airdropUnits * bps) / maxUnits);
  const publicBp = overAllocated ? 0 : BPS - airdropBp - treasuryLockBp - teamBp;
  const slices: AllocationSlice[] = [
    { id: "public", label: "Public · OTC launch curve", units: publicUnits, bp: publicBp },
    {
      id: "yield",
      label: "Yield reserve ($OTC · CRCLx · OpenAI · Anthropic basket)",
      units: yieldReserveUnits,
      bp: yieldReserveBp,
    },
    {
      id: "lp",
      label: "LP reserve (liquidity seed)",
      units: lpUnits,
      bp: lpBp,
    },
    {
      id: "airdrop",
      label: `Desk airdrop (${AIRDROP_PER_DESK.toLocaleString()} / desk, capped at ${airdropDeskCap.toLocaleString()} desks)`,
      units: airdropUnits,
      bp: airdropBp,
    },
    { id: "team", label: "Dev / team", units: teamUnits, bp: teamBp },
  ];
  return {
    maxUnits,
    deskCount,
    airdropPerDeskUnits: perDesk,
    airdropEligibleDeskCount,
    airdropDeskCap,
    airdropCapped,
    slices,
    airdropUnits,
    treasuryLockUnits,
    yieldReserveUnits,
    lpUnits,
    teamUnits,
    publicUnits,
    overAllocated,
  };
}

/** Display names for tiers 1–4 (§A4): market-role ladder, not metals. */
export const TIER_NAMES = ["TRADER", "BROKER", "DEALER", "MARKET MAKER"] as const;

/** Cumulative step fee to reach `tier` from tier 0 (§A4). */
export const cumulativeFeeLamports = (tier: number) => STEP_FEE_LAMPORTS * tier;
/** Fee to move `from` → `to` (from = 0 is a fresh activation). */
export const stepFeeLamports = (from: number, to: number) => STEP_FEE_LAMPORTS * (to - from);

/**
 * $OTC base units due for `feeLamports` — mirrors `OtcPayConfig::otc_fee`:
 * `⌈fee × otcPerSol × premiumBp / (10⁹ × 10⁴)⌉` (rounds up in the protocol's favour).
 */
export function otcFeeUnits(
  feeLamports: number | bigint,
  otcPerSol: number | bigint,
  premiumBp: number = OTC_PREMIUM_BP,
): bigint {
  const num = BigInt(feeLamports) * BigInt(otcPerSol) * BigInt(premiumBp);
  const den = BigInt(LAMPORTS_PER_SOL) * BigInt(BPS);
  return (num + den - 1n) / den;
}
/** 90/10 split of a step fee. */
export const splitFee = (fee: number) => {
  const toOps = Math.floor((fee * OPS_PCT_BP) / BPS);
  return { toOps, toPot: fee - toOps };
};
