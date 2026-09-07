// Pure projection math for the Part C yield table (§C4/§C5). Everything here is an ESTIMATE
// that scales with Σw — the UI must label it as such.
import { BPS, TIER_WEIGHTS_BP, cumulativeFeeLamports, type EpochView } from "@hub-sdk";

export type Scenario = "conservative" | "current" | "bull";

export const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: "conservative", label: "CONSERVATIVE", hint: "cohort doubles (Σw ×2), same inflow" },
  { id: "current", label: "CURRENT", hint: "live inflow and Σw as read on-chain" },
  { id: "bull", label: "BULL", hint: "inflow doubles, same cohort" },
];

export type ScenarioInputs = {
  inflowLamports: number;
  totalWeightBp: number;
  burnPctBp: number;
};

export function applyScenario(base: ScenarioInputs, s: Scenario): ScenarioInputs {
  if (s === "conservative") return { ...base, totalWeightBp: base.totalWeightBp * 2 };
  if (s === "bull") return { ...base, inflowLamports: base.inflowLamports * 2 };
  return base;
}

/** Distributable share of an epoch's inflow after the burn slice (§A5). */
export const distributableLamports = (inflowLamports: number, burnPctBp: number) =>
  inflowLamports - Math.floor((inflowLamports * burnPctBp) / BPS);

/** Per-tier payout for one epoch under `inputs`; 0 while Σw is empty. */
export function tierPayoutLamports(tier: number, inputs: ScenarioInputs) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || inputs.totalWeightBp <= 0) return 0;
  const dist = distributableLamports(inputs.inflowLamports, inputs.burnPctBp);
  return Math.floor((dist * w) / inputs.totalWeightBp);
}

export type TierRow = {
  tier: number;
  weightBp: number;
  cumulativeFeeLamports: number;
  epochLamports: number;
  dailyLamports: number;
  weeklyLamports: number;
  monthlyLamports: number;
  /** Epochs until cumulative fee is recovered; null when payout is 0. */
  breakevenEpochs: number | null;
};

export function buildTierRows(inputs: ScenarioInputs, epochDurationSecs: number): TierRow[] {
  const perDay = 86400 / Math.max(1, epochDurationSecs);
  return TIER_WEIGHTS_BP.map((weightBp, i) => {
    const tier = i + 1;
    const epochLamports = tierPayoutLamports(tier, inputs);
    const dailyLamports = epochLamports * perDay;
    const fee = cumulativeFeeLamports(tier);
    return {
      tier,
      weightBp,
      cumulativeFeeLamports: fee,
      epochLamports,
      dailyLamports,
      weeklyLamports: dailyLamports * 7,
      monthlyLamports: dailyLamports * 30,
      breakevenEpochs: epochLamports > 0 ? Math.ceil(fee / epochLamports) : null,
    };
  });
}

/** Scenario inputs from the open epoch + config; extracted so scenarios can override each field. */
export const baseInputs = (
  e: EpochView,
  config: { totalWeightBp: number; burnPctBp: number },
): ScenarioInputs => ({
  inflowLamports: e.inflowLamports,
  totalWeightBp: config.totalWeightBp,
  burnPctBp: config.burnPctBp,
});

/** Sum of finalized payouts a tier could still claim across `epochs`. */
export const unclaimedEstimate = (tier: number, epochs: EpochView[]): number =>
  epochs.reduce((acc, e) => {
    const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
    if (!e.finalized || !w || e.totalWeightBp === 0) return acc;
    return acc + Math.floor((e.distributedLamports * w) / e.totalWeightBp);
  }, 0);

/** §A6.1: warn owners before listing/consigning when unclaimed yield is material. */
export const CONSIGN_WARN_LAMPORTS = 20_000_000;
