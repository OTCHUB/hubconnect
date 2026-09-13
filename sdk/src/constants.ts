// Mirror of programs/hub/src/constants.rs (Appendix, spec v1.2). Keep in sync.
export const BPS = 10_000;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const TIER_WEIGHTS_BP = [10_000, 12_500, 16_000, 20_000] as const;
export const TIER_WEIGHTS = TIER_WEIGHTS_BP.map((w) => w / BPS); // [1.00,1.25,1.60,2.00]
/**
 * Legacy flat activation/upgrade SOL fee (0.5 SOL) — superseded by `TIER_STEP_FEE_LAMPORTS`
 * below. Kept only because `ConfigView.stepFeeLamports` still mirrors the on-chain `Config`'s
 * dead-but-layout-stable field; the fee actually charged now comes from `TierFeeConfig`
 * (`tierFeePda`), fetched live via `fetchTierFee` (`./reader`) — prefer that (or
 * `cumulativeFeeLamports`/`stepFeeLamports` below, updated to read it) over this constant.
 */
export const STEP_FEE_LAMPORTS = LAMPORTS_PER_SOL / 2;
/**
 * TIER_STEP_FEE_LAMPORTS: ascending per-tier flat SOL fee (§A4, revised) — T1 0.2 SOL, T2 0.3
 * SOL, T3 0.4 SOL, T4 0.5 SOL. Mirrors `TIER_STEP_FEE_LAMPORTS` in constants.rs — the genesis
 * default `init_tier_fee_config` seeds `TierFeeConfig` with; the live, admin-retunable value is
 * `TierFeeView.tierStepFeeLamports` (`./reader`). Paid once per `activate_tier` / `upgrade_tier`
 * (or the $OTC-path equivalents), indexed by the *target* tier reached — never the tier being
 * left nor the number of steps crossed.
 */
export const TIER_STEP_FEE_LAMPORTS = [
  (LAMPORTS_PER_SOL * 2) / 10, // T1 0.2 SOL
  (LAMPORTS_PER_SOL * 3) / 10, // T2 0.3 SOL
  (LAMPORTS_PER_SOL * 4) / 10, // T3 0.4 SOL
  (LAMPORTS_PER_SOL * 5) / 10, // T4 0.5 SOL
] as [number, number, number, number];
export const OPS_PCT_BP = 1_000;
/**
 * §A5 round split (unrelated to the flat-fee 90/10 above, 4-way): 90% buys $OTC and is
 * distributed pro-rata to activated desks (credited through `Config.accPerWeight`, paid out by
 * `claim_yield` in $OTC — see `OtcPotView`/`otcDueForLamports`). The other 10% is swapped
 * SOL→$HUB in a single synchronous on-chain Jupiter CPI inside `finalize_epoch`, then the
 * received $HUB splits 50/25/25 (of that 10%, i.e. 5%/2.5%/2.5% of total inflow): burned / earmarked
 * for the $HUB/$OTC LP (`TreasuryView.lpPendingHubUnits`) / deposited into the treasury float
 * (buy-and-hold, capped at `TREASURY_HUB_FLOAT_CAP_BP` of supply).
 */
export const BURN_PCT_BP = 500;
export const LP_PCT_BP = 250;
export const TREASURY_FLOAT_PCT_BP = 250;
/**
 * $HUB base units required to reach each tier from scratch (cumulative table, not incremental) —
 * mirrors `TIER_HUB_COST_UNITS` in constants.rs: T1 1,000,000 (1M), T2 1,250,000, T3 1,500,000,
 * T4 2,000,000 (raised 10x from the original 100k/125k/150k/200k once $HUB's realized market
 * price fell far enough that the live, price-derived cost was pinned at the old ceiling for
 * every tier). This is the *genesis/ceiling* table only — the live per-tier cost the program
 * actually charges tracks a fixed USD target (`TIER_USD_COST_MICROS`) via
 * `Config.tier_hub_cost_units_cached`, refreshed from a realized Jupiter swap at
 * `finalize_epoch`, and can be cheaper than this table whenever $HUB's market price is fresh
 * (not stale) — see `liveHubCostUnits`/`liveHubCostDeltaUnits` in `./reader`, which apply that
 * cache + `PRICE_STALENESS_SECS` fallback exactly like the on-chain `Config::hub_cost`/
 * `hub_cost_delta`. Prefer those over this table directly for any UI/quote that should match
 * what the program will actually charge right now; this table remains the correct choice only
 * when no live `ConfigView` is available yet, or as the known worst case.
 *
 * Note: raising this ceiling does not retroactively jump an already-initialized `Config`'s
 * cached cost — that can only move by ±`PRICE_CLAMP_BP` (10%) per price-eligible round, so a
 * cache pinned at the old ceiling needs ~25 eligible rounds of sustained +10% moves to reach
 * this new one.
 */
export const TIER_HUB_COST_UNITS = [1_000_000, 1_250_000, 1_500_000, 2_000_000].map(
  (v) => v * 10 ** 6,
) as [number, number, number, number];
/**
 * Fixed USD target for each tier, in micro-USDC (6 decimals) — $50/$60/$70/$80 cumulative. Never
 * moves; what moves is how many $HUB tokens currently equal it (see `TIER_HUB_COST_UNITS`'s doc).
 */
export const TIER_USD_COST_MICROS = [50_000_000, 60_000_000, 70_000_000, 80_000_000] as [
  number,
  number,
  number,
  number,
];
/** A round's priced leg must be at least this large to be eligible to move the cached $HUB-per-
 *  tier cost — a thinner trade is skipped (not trusted) rather than accepted at face value. */
export const PRICE_UPDATE_MIN_SOL_LAMPORTS = LAMPORTS_PER_SOL / 5; // 0.2 SOL
/** Symmetric clamp: an eligible round may move each tier's cached cost by at most this many bp,
 *  in either direction, from its previous value. */
export const PRICE_CLAMP_BP = 1_000; // ±10% per eligible round
/** The cached cost may never shrink below this % of `TIER_HUB_COST_UNITS` (the genesis/ceiling
 *  table) — a hard minimum-burn guarantee, however high $HUB's real price climbs. */
export const TIER_HUB_COST_FLOOR_BP = 1_000; // 10% of ceiling
/** If the cached cost hasn't been refreshed by an eligible round in this long, the live cost
 *  falls back to the ceiling table instead of trading off a possibly-stale price. */
export const PRICE_STALENESS_SECS = 86_400; // 24h
/** Of every tier activation/upgrade's $HUB cost, this fraction is burned outright (`BurnChecked`,
 *  permanent); the remainder credits the active-desk reward pool (`TokenomicsConfig`'s
 *  `treasury_lock_vault`, distributed pro-rata by tier weight the next `distribute_treasury_reward`)
 *  instead of vanishing — a real yield source on top of the round-split "HUB Protocol Boost". */
export const TIER_COST_BURN_BP = 5_000; // 50% burn / 50% -> active-desk reward pool
/** A round closes once its inflow reaches this (OTC desk-pot trigger: 0.1 SOL). */
export const MIN_POT_THRESHOLD_LAMPORTS = LAMPORTS_PER_SOL / 10;
/** Fixed-point scale of `Config.acc_per_weight` (lamports × ACC_SCALE per bp of weight). */
export const ACC_SCALE = 1_000_000_000_000n;

export const EXIT_DISCOUNT_BP = 1_000;
export const EXIT_HUB_LEG_BP = 5_000;
export const SWEEP_BUDGET_CAP_BP = 1_000;
export const SWEEP_PAYBACK_CAP_LAMPORTS = 4_200_000_000;
export const FLOOR_STALENESS_BP = 500;
export const LP_ENABLED = false;
export const LP_TARGET_SOL_LAMPORTS = 100 * LAMPORTS_PER_SOL;
/** Dust floor `compound_lp_otc`/`compound_lp_basket` require `TreasuryState.lp_pending_hub_units`
 * to clear before compounding (100 $HUB, 6dp) — mirrors `LP_COMPOUND_MIN_HUB_UNITS`. */
export const LP_COMPOUND_MIN_HUB_UNITS = 100 * 10 ** 6;
/** Experimental, admin-updatable via `set_treasury_float_cap_bp` (§A6.3/§A7.1 "we are
 * experimenting") — excess over the live cap at deposit time is burned, never rejected. */
export const TREASURY_HUB_FLOAT_CAP_BP = 500;

/**
 * §A4.1 $OTC payment path (revised): `activate_tier_otc` / `upgrade_tier_otc` charge the same
 * ascending per-tier SOL fee as the SOL path (90% pot / 10% ops — see `TIER_STEP_FEE_LAMPORTS`)
 * **plus** an $OTC-denominated
 * 2× premium that replaces the tier's direct $HUB burn. Pricing is no longer a static
 * authority-refreshed rate — it's a real synchronous on-chain Jupiter OTC→$HUB swap, so it's
 * dynamic as $HUB's market price moves. The caller supplies `otcSwapAmount` (sized off-chain via
 * a live Jupiter quote so the swap clears at least `liveHubCostDeltaUnits` (`./reader`) — enforced on-chain via
 * balance-delta); an equal-scaled $OTC amount (`otcPotLeg`) is charged again and injected
 * straight into `OtcPotState.otc_vault` (no swap — raises `total_otc_bought_units`, lifting the
 * lifetime average buy rate `claim_yield` prices every desk's yield at), so the total $OTC
 * charged is ~2× the swap leg's cost.
 */
export const OTC_PAY_SWAP_BURN_PCT_BP = 5_000;

/**
 * §A6.3 second flywheel — the treasury's pro-rata claim on the OTC launcher's 70%
 * holders-in-stock leg (already $OTC, since the treasury holds 2% of $HUB supply). Re-split
 * 80/5/5/5/5 every time the pending balance clears the threshold: 80% is a direct, swap-free
 * injection into the $OTC yield pot (raises everyone's lifetime average buy rate); the other
 * four 5% legs each need an off-chain swap the keeper attests back on-chain.
 */
export const CREATOR_FEE_DESK_POT_BP = 8_000;
export const CREATOR_FEE_BURN_BP = 500;
export const CREATOR_FEE_LP_BP = 500;
export const CREATOR_FEE_STACK_BP = 500;
export const CREATOR_FEE_OPS_BP = 500;
/** Default clearing threshold: 1,000 $OTC (assumes 6 decimals; authority-adjustable at init). */
export const CREATOR_FEE_CLEAR_THRESHOLD_UNITS = 1_000 * 10 ** 6;

/** §A6.2 phase-2 lock+burn AMM — Raydium CP-Swap (mainnet + devnet, same address). */
export const RAYDIUM_CP_SWAP_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
/** Raydium's dedicated CP-Swap liquidity-locking program (burn LP mint, permanent fee claim). */
export const RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID = "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE";
/** Jupiter aggregator v6 — pinned in `jupiter_swap::swap_exact_in`'s synchronous CPI leg
 * (`finalize_epoch`'s round-split swap and `otc_pay.rs`'s 2× premium swap-burn leg). Only valid
 * against a `hub` build compiled *without* the `mock-jupiter` feature (the default/mainnet
 * build) — see `MOCK_JUPITER_PROGRAM_ID` for devnet builds compiled with it. */
export const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** Devnet/localnet testing only (`programs/mock_jupiter`) — the swap target `hub`'s
 * `JUPITER_PROGRAM_ID` constant resolves to when built with the `mock-jupiter` Cargo feature.
 * Never valid against a mainnet-beta deployment; use `scripts/lib/mock-jupiter.ts` to build
 * routes against it, not `keeper/keeper/src/jupiter.ts`'s real Jupiter quote API. */
export const MOCK_JUPITER_PROGRAM_ID = "BvjZ2YNTxKmKKKWUiNNRG83tQr5djiMMPBAGJxiZZn5C";
/** Native mint (wrapped SOL) — hop1's input in `finalize_epoch`'s two-hop WSOL→USDC→$HUB route. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** Circle USDC (mainnet-beta) — hop1's output / hop2's input in `finalize_epoch`'s two-hop route,
 * and `Config.usdc_mint`'s expected value on a mainnet deploy. Devnet/localnet deploys point
 * `Config.usdc_mint` at a mock mint instead (see `scripts/mock-jupiter-setup.ts`). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * `finalize_epoch`'s hop2 (USDC→$HUB) direct-CPI target (mainnet-beta only) — a Raydium CP-Swap
 * pool the team seeded so hop2 can bypass Jupiter's Metis routing engine entirely, which gates
 * newly-created/thin pools out of "normal routing" on a liquidity-depth check regardless of the
 * pool itself being real and swappable on-chain (see `raydium_cpswap::swap_base_input` and
 * `epochs.rs`'s `finalize_epoch` doc comment). token_0 = $HUB, token_1 = USDC. All addresses are
 * fixed for this pool's lifetime (Raydium CP-Swap pools cannot change their vaults/config/mints
 * post-creation).
 */
export const HUB_USDC_POOL = {
  poolState: "BrconjFBxBxTHSJcE93tNteY7usiJQfYDt65SCyEbZmX",
  ammConfig: "G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc",
  /** Raydium's global `vault_and_lp_mint_auth_seed` PDA — identical across every CP-Swap pool. */
  authority: "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
  /** token_0_vault — pool-owned $HUB reserve. */
  hubVault: "3oJ1N54kT255VGDsjbXKcoutxi6ox1KLkdxcQjsSPRgb",
  /** token_1_vault — pool-owned USDC reserve. */
  usdcVault: "CQQgaqqSRk15QZgY78SWaJWNzcMRkzeZB5EvLvkFmsdE",
  observationState: "6s67NAWCGhpzQDsNizxvReo8nVyarM259FTDxb1Ft8Nu",
  /** `amm_config.trade_fee_rate` / denominator 1_000_000 — 1%, fixed at pool creation. Used only
   * to floor an off-chain `minimum_amount_out` estimate (`keeper/keeper/src/raydium.ts`); the
   * on-chain swap itself trusts the post-CPI balance delta, not this estimate. */
  tradeFeeRate: 10_000,
  tradeFeeRateDenominator: 1_000_000,
} as const;

export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const HUB_PROGRAM_ID = "7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Token-2022 program — $OTC and the whole M.I.M ETF basket (CRCLx/NVDAx/SPCXx) are Token-2022
 * mints; $HUB/WSOL/USDC remain classic `TOKEN_PROGRAM_ID`. Pass whichever one actually owns a
 * given mint to `ataPda`/`createAtaIdempotentIx` — never assume classic. */
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
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
 * Mirrors the on-chain `AIRDROP_DESK_CAP` constant: `set_airdrop_root` rejects any `desk_count`
 * above this. Multiple snapshot rounds are supported — the team may run an early round with
 * fewer than 2,500 desks and distribute first, then raise `desk_count` in a later round (never
 * lower it once claims have started) to onboard desks minted since, up to this cap. Kept here
 * too so the preview math and UI agree with the program before a snapshot is even published.
 */
export const AIRDROP_DESK_CAP = 2_500;
/** Yield reserve: 2% of supply backing the OTC-launcher reward basket ($OTC, CRCLx, NVDAx, SPCXx). */
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
      label: "Yield reserve ($OTC · CRCLx · NVDAx · SPCXx basket)",
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

/**
 * Ascending, *cumulative* per-tier SOL fee for a fresh activation into `tier` (§A4, revised), off
 * the *genesis default* table only (`TIER_STEP_FEE_LAMPORTS`) — ignores any live admin retune via
 * `set_tier_step_fee`. Prefer `TierFeeView.tierStepFeeLamports[tier - 1]` (`./reader`) wherever a
 * live `TierFeeView` is available; this remains correct only as the known genesis default.
 */
export const cumulativeFeeLamports = (tier: number) => TIER_STEP_FEE_LAMPORTS[tier - 1] ?? 0;
/**
 * SOL fee to move `from` → `to` (`from = 0` is a fresh activation), off the genesis default
 * table — mirrors on-chain `TierFeeConfig::step_fee`: a fresh activation (`from = 0`) costs the
 * target tier's full cumulative fee, while an upgrade costs only the *difference* between the two
 * tiers' cumulative fees (T1→T2 = 0.1 SOL, T1→T4 = 0.3 SOL) — never the target tier's full fee
 * again on top of what was already paid to reach `from`. See `cumulativeFeeLamports`'s caveat
 * above re: live vs. genesis-default values.
 */
export const stepFeeLamports = (from: number, to: number) =>
  cumulativeFeeLamports(to) - (from > 0 ? cumulativeFeeLamports(from) : 0);

/** $HUB base units required to reach `tier` from scratch, off the *genesis/ceiling* table only
 *  (§A4, cumulative table lookup) — ignores the live price cache entirely. Prefer `liveHubCostUnits`
 *  (`./reader`) wherever a `ConfigView` is available; this remains correct as the known worst
 *  case, or when no live config has loaded yet. */
export const cumulativeHubCostUnits = (tier: number) => TIER_HUB_COST_UNITS[tier - 1] ?? 0;
/**
 * $HUB due for `from` → `to` off the genesis/ceiling table only (`from = 0` is a fresh
 * activation: the full cost of `to`) — see `cumulativeHubCostUnits`'s caveat above; prefer
 * `liveHubCostDeltaUnits` (`./reader`) wherever a `ConfigView` is available. An upgrade only ever
 * burns the difference, never the same $HUB twice.
 */
export function hubCostDeltaUnits(from: number, to: number): number {
  const toCost = cumulativeHubCostUnits(to);
  if (from === 0) return toCost;
  return toCost - cumulativeHubCostUnits(from);
}

/** 90/10 split of a step fee. */
export const splitFee = (fee: number) => {
  const toOps = Math.floor((fee * OPS_PCT_BP) / BPS);
  return { toOps, toPot: fee - toOps };
};

/**
 * Mirrors `otc_pay::otc_pot_leg` — `otcPaidTotal = otcSwapAmount × BPS / OTC_PAY_SWAP_BURN_PCT_BP`
 * (currently an even 50/50, so `otcPaidTotal = otcSwapAmount × 2`); the desk-pot leg
 * (`toOtcPot`) is the remainder charged straight into `OtcPotState.otc_vault`, no swap.
 */
export function otcPotLeg(otcSwapAmount: bigint): { otcPaidTotal: bigint; toOtcPot: bigint } {
  const otcPaidTotal = (otcSwapAmount * BigInt(BPS)) / BigInt(OTC_PAY_SWAP_BURN_PCT_BP);
  return { otcPaidTotal, toOtcPot: otcPaidTotal - otcSwapAmount };
}
