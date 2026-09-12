// Pure projection math for the Part C yield table (§C4/§C5). Everything here is an ESTIMATE
// that scales with Σw — the UI must label it as such.
import {
  BPS,
  LAMPORTS_PER_SOL,
  TIER_WEIGHTS_BP,
  cumulativeFeeLamports,
  effectiveInflowLamports,
  liveHubCostUnits,
  type ConfigView,
  type EpochView,
  type TierFeeView,
} from "@hub-sdk";

export type RoundInputs = {
  /** Inflow the next round is projected to close with. */
  roundInflowLamports: number;
  totalWeightBp: number;
  burnPctBp: number;
  /** §A5 2.5% — swapped SOL→$HUB alongside the burn slice, earmarked for the phase-2 LP build. */
  lpPctBp: number;
  /** §A5 2.5% — swapped SOL→$HUB alongside the burn slice, earmarked for the treasury float. */
  treasuryFloatPctBp: number;
};

/**
 * Distributable share of a round's inflow after the 4-way split's swap legs come off (§A5:
 * 5% burn / 2.5% LP / 2.5% treasury float — all three swapped SOL→$HUB in one synchronous
 * Jupiter CPI at `finalize_epoch`; the remaining 90% is the distributable $OTC leg).
 */
export const distributableLamports = (
  inflowLamports: number,
  burnPctBp: number,
  lpPctBp: number,
  treasuryFloatPctBp: number,
) =>
  inflowLamports -
  Math.floor((inflowLamports * burnPctBp) / BPS) -
  Math.floor((inflowLamports * lpPctBp) / BPS) -
  Math.floor((inflowLamports * treasuryFloatPctBp) / BPS);

/** Per-tier payout for one round under `inputs`; 0 while Σw is empty. */
export function tierPayoutLamports(tier: number, inputs: RoundInputs) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || inputs.totalWeightBp <= 0) return 0;
  const dist = distributableLamports(
    inputs.roundInflowLamports,
    inputs.burnPctBp,
    inputs.lpPctBp,
    inputs.treasuryFloatPctBp,
  );
  return Math.floor((dist * w) / inputs.totalWeightBp);
}

export type TierRow = {
  tier: number;
  weightBp: number;
  cumulativeFeeLamports: number;
  /** Live $HUB burn to reach this tier from scratch — see `liveHubCostUnits`; tracks the on-chain
   *  price cache (cheaper than the genesis/ceiling table once fresh), not a static lookup. */
  hubCostUnits: number;
  roundLamports: number;
  /** null when the round cadence is unknown (no closed round yet). */
  dailyLamports: number | null;
  /** Rounds until cumulative fee is recovered; null when payout is 0. */
  breakevenRounds: number | null;
};

/**
 * Rounds close permissionlessly the instant inflow crosses `min_pot_threshold_lamports` — no
 * clock, no fixed cadence. Below this floor, a closed round's duration is almost certainly a
 * devnet/test artifact (rapid faucet-driven transactions hitting a tiny test threshold in
 * seconds), not an organic trading cadence — extrapolating a day/week/month rate from it would
 * show an impossible number (e.g. a single test desk "earning" 60+ SOL/day off a 0.1 SOL round).
 * Below this floor we refuse to extrapolate at all; callers fall back to /round-only figures
 * until a real close takes at least this long.
 */
export const MIN_REALISTIC_ROUND_SECS = 3_600; // 1 hour

/**
 * Rounds have no clock — they close whenever inflow reaches the threshold. The only on-chain
 * cadence signal is how long the last closed round took; null before the first close, or when
 * that close was too fast to trust (see `MIN_REALISTIC_ROUND_SECS`).
 */
export function roundsPerDay(previous: EpochView | null): number | null {
  if (!previous || !previous.finalized) return null;
  const secs = previous.finalizedTs - previous.startTs;
  return secs >= MIN_REALISTIC_ROUND_SECS ? 86400 / secs : null;
}

export function buildTierRows(
  inputs: RoundInputs,
  perDay: number | null,
  config: ConfigView,
  nowTs: number,
  tierFee?: TierFeeView | null,
): TierRow[] {
  return TIER_WEIGHTS_BP.map((weightBp, i) => {
    const tier = i + 1;
    const roundLamports = tierPayoutLamports(tier, inputs);
    const fee = tierFee?.tierStepFeeLamports[tier - 1] ?? cumulativeFeeLamports(tier);
    return {
      tier,
      weightBp,
      cumulativeFeeLamports: fee,
      hubCostUnits: liveHubCostUnits(tier, nowTs, config),
      roundLamports,
      dailyLamports: perDay === null ? null : roundLamports * perDay,
      breakevenRounds: roundLamports > 0 ? Math.ceil(fee / roundLamports) : null,
    };
  });
}

/**
 * Live projection inputs from the open round + config. A round closes the moment effective
 * inflow reaches the threshold, so the projected round size is the threshold — or the live
 * inflow when a large booking has already pushed it past.
 */
export const baseInputs = (e: EpochView, config: ConfigView): RoundInputs => ({
  roundInflowLamports: Math.max(config.minPotThresholdLamports, effectiveInflowLamports(e, config)),
  totalWeightBp: config.totalWeightBp,
  burnPctBp: config.burnPctBp,
  lpPctBp: config.lpPctBp,
  treasuryFloatPctBp: config.treasuryFloatPctBp,
});

/** Warn owners before listing/transferring when unclaimed yield is material. */
export const UNCLAIMED_WARN_LAMPORTS = 20_000_000;

/**
 * §A5/§A8 raw desk-pot take D — "Latest closed day take: 0.1443 SOL/desk/day" (worked example,
 * recompute never promise). This is an **un-activated** desk's baseline "Native Yield" — the
 * `EarningPreview` default whenever the host doesn't supply a live `rawDeskDailyLamports` figure
 * (otchub's own desk-pot telemetry). Do not confuse with the ≈0.33 SOL/day figure elsewhere in
 * §A8 — that's the *activated* T1 total (native + protocol boost combined) under a specific
 * Σw=520 base-case scenario, not the raw/un-activated baseline.
 */
export const DEFAULT_RAW_DESK_SOL = 0.1443;
export const DEFAULT_RAW_DESK_DAILY_LAMPORTS = Math.round(DEFAULT_RAW_DESK_SOL * LAMPORTS_PER_SOL);

/**
 * Yield boost vs the base (T1 TRADER, 1.00x) tier weight, as a whole percent — e.g. T3 DEALER
 * (1.60x) ⇒ 60. 0 for T1 or an unrecognized tier (raw desks have no boost).
 */
export function yieldBoostPctOverBase(tier: number): number {
  const base = TIER_WEIGHTS_BP[0] ?? BPS;
  const w = TIER_WEIGHTS_BP[tier - 1];
  if (!base || w == null) return 0;
  return Math.round(((w - base) / base) * 100);
}

/** Fixed collection size — the Core collection never mints past this (deployments.ts, spec §A2). */
export const MAX_DESK_SUPPLY = 5_000;

/**
 * Next planned circulating-desk checkpoint used for the tokenomics progress display. Desk count
 * itself is always read live from the on-chain collection (never hardcoded) — this is only a
 * forward-looking target, bumped by hand as the collection approaches it.
 */
export const NEXT_DESK_SUPPLY_MILESTONE = 2_500;

/** 0–100 progress of `deskCount` toward `NEXT_DESK_SUPPLY_MILESTONE`, clamped. */
export function deskMilestoneProgressPct(deskCount: number): number {
  if (NEXT_DESK_SUPPLY_MILESTONE <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((deskCount / NEXT_DESK_SUPPLY_MILESTONE) * 100)));
}

/**
 * Launch target for treasury-owned desks (bought via market sweeps — desks are never donated or
 * consigned for free), not a program constant — bumped by hand as the treasury's desk stack
 * grows. Used only for the progress display; the actual count is always read live from
 * `TreasuryState.desks_owned`.
 */
export const TREASURY_DESK_TARGET = 20;

/** 0–100 progress of `desksOwned` toward `TREASURY_DESK_TARGET`, clamped. */
export function treasuryDeskProgressPct(desksOwned: number): number {
  if (TREASURY_DESK_TARGET <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((desksOwned / TREASURY_DESK_TARGET) * 100)));
}
