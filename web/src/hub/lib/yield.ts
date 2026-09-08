// Pure projection math for the Part C yield table (§C4/§C5). Everything here is an ESTIMATE
// that scales with Σw — the UI must label it as such.
import {
  BPS,
  TIER_WEIGHTS_BP,
  cumulativeFeeLamports,
  effectiveInflowLamports,
  type ConfigView,
  type EpochView,
} from "@hub-sdk";

export type Scenario = "conservative" | "current" | "bull";

export const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: "conservative", label: "CONSERVATIVE", hint: "cohort doubles (Σw ×2), same round size" },
  { id: "current", label: "CURRENT", hint: "round closes at threshold (or live inflow if above)" },
  { id: "bull", label: "BULL", hint: "rounds close at 2× the size, same cohort" },
];

export type ScenarioInputs = {
  /** Inflow the next round is projected to close with. */
  roundInflowLamports: number;
  totalWeightBp: number;
  burnPctBp: number;
};

export function applyScenario(base: ScenarioInputs, s: Scenario): ScenarioInputs {
  if (s === "conservative") return { ...base, totalWeightBp: base.totalWeightBp * 2 };
  if (s === "bull") return { ...base, roundInflowLamports: base.roundInflowLamports * 2 };
  return base;
}

/** Distributable share of a round's inflow after the burn slice (§A5). */
export const distributableLamports = (inflowLamports: number, burnPctBp: number) =>
  inflowLamports - Math.floor((inflowLamports * burnPctBp) / BPS);

/** Per-tier payout for one round under `inputs`; 0 while Σw is empty. */
export function tierPayoutLamports(tier: number, inputs: ScenarioInputs) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || inputs.totalWeightBp <= 0) return 0;
  const dist = distributableLamports(inputs.roundInflowLamports, inputs.burnPctBp);
  return Math.floor((dist * w) / inputs.totalWeightBp);
}

export type TierRow = {
  tier: number;
  weightBp: number;
  cumulativeFeeLamports: number;
  roundLamports: number;
  /** null when the round cadence is unknown (no closed round yet). */
  dailyLamports: number | null;
  /** Rounds until cumulative fee is recovered; null when payout is 0. */
  breakevenRounds: number | null;
};

/**
 * Rounds have no clock — they close whenever inflow reaches the threshold. The only on-chain
 * cadence signal is how long the last closed round took; null before the first close.
 */
export function roundsPerDay(previous: EpochView | null): number | null {
  if (!previous || !previous.finalized) return null;
  const secs = previous.finalizedTs - previous.startTs;
  return secs > 0 ? 86400 / secs : null;
}

export function buildTierRows(inputs: ScenarioInputs, perDay: number | null): TierRow[] {
  return TIER_WEIGHTS_BP.map((weightBp, i) => {
    const tier = i + 1;
    const roundLamports = tierPayoutLamports(tier, inputs);
    const fee = cumulativeFeeLamports(tier);
    return {
      tier,
      weightBp,
      cumulativeFeeLamports: fee,
      roundLamports,
      dailyLamports: perDay === null ? null : roundLamports * perDay,
      breakevenRounds: roundLamports > 0 ? Math.ceil(fee / roundLamports) : null,
    };
  });
}

/**
 * Scenario inputs from the open round + config. A round closes the moment effective inflow
 * reaches the threshold, so the projected round size is the threshold — or the live inflow when
 * a large booking has already pushed it past.
 */
export const baseInputs = (e: EpochView, config: ConfigView): ScenarioInputs => ({
  roundInflowLamports: Math.max(config.minPotThresholdLamports, effectiveInflowLamports(e, config)),
  totalWeightBp: config.totalWeightBp,
  burnPctBp: config.burnPctBp,
});

/** Warn owners before listing/transferring when unclaimed yield is material. */
export const UNCLAIMED_WARN_LAMPORTS = 20_000_000;

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
 * Launch target for treasury-owned desks (sweeps + donations), not a program constant — bumped
 * by hand as the treasury's desk stack grows. Used only for the progress display; the actual
 * count is always read live from `TreasuryState.desks_owned`.
 */
export const TREASURY_DESK_TARGET = 20;

/** 0–100 progress of `desksOwned` toward `TREASURY_DESK_TARGET`, clamped. */
export function treasuryDeskProgressPct(desksOwned: number): number {
  if (TREASURY_DESK_TARGET <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((desksOwned / TREASURY_DESK_TARGET) * 100)));
}
