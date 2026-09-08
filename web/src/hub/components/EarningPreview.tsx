import { useMemo, useState } from "react";
import {
  HUB_DECIMALS,
  LAMPORTS_PER_SOL,
  TIER_HUB_COST_UNITS,
  TIER_NAMES,
  TIER_WEIGHTS_BP,
  type ProtocolState,
} from "@hub-sdk";
import { fmtNum, fmtSol, fmtWeight } from "../lib/format";
import {
  applyScenario,
  baseInputs,
  buildTierRows,
  roundsPerDay,
  type Scenario,
} from "../lib/yield";
import { RawDeskInput } from "./RawDeskInput";
import { ScenarioToggle } from "./ScenarioToggle";
import { Panel } from "./ui/Panel";

export const ESTIMATE_LABEL = "ESTIMATE — scales with Σw; not a promise";

type Props = {
  state: ProtocolState;
  /** Host-supplied baseline (otchub knows desk pot revenue); shows an input when omitted. */
  rawDeskDailyLamports?: number;
};

/** Highest tier a given $HUB amount (whole tokens) affords via activate_tier's cumulative burn
 *  (§A4) — 0 when it doesn't cover even T1 TRADER (100,000 $HUB). */
function tierForHub(hubTokens: number): number {
  const units = Math.max(0, hubTokens) * 10 ** HUB_DECIMALS;
  let tier = 0;
  for (let i = 0; i < TIER_HUB_COST_UNITS.length; i++) {
    if (units >= TIER_HUB_COST_UNITS[i]) tier = i + 1;
  }
  return tier;
}

function ProjectionRows({ perRound, perDay }: { perRound: number; perDay: number | null }) {
  return (
    <div className="mt-2 space-y-0.5 text-xs">
      <div className="flex justify-between gap-3">
        <span className="text-green-700">/ round</span>
        <span>{fmtSol(perRound, 4)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-green-700">/ day</span>
        <span>{perDay === null ? "—" : fmtSol(perDay, 4)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-green-700">/ week</span>
        <span>{perDay === null ? "—" : fmtSol(perDay * 7)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-green-700">/ month</span>
        <span>{perDay === null ? "—" : fmtSol(perDay * 30)}</span>
      </div>
    </div>
  );
}

/** §C4 — dynamic side-by-side comparison of Standard Yield (raw, un-activated desk) vs Boosted
 *  Yield (the tier a user-inputted $HUB amount can activate), driven by the same live protocol
 *  rates (round size, Σw, burn slice) as the rest of the yield engine (../lib/yield.ts). Replaces
 *  the old flat per-tier table with a calculator framed the way a holder actually decides: "if I
 *  burn this much $HUB, what do I earn instead of a raw desk?" */
export function EarningPreview({ state, rawDeskDailyLamports }: Props) {
  const [scenario, setScenario] = useState<Scenario>("current");
  const [rawSol, setRawSol] = useState("0");
  const [hubAmount, setHubAmount] = useState("125000"); // default: T2 BROKER activation cost

  const raw = rawDeskDailyLamports ?? Math.max(0, Number(rawSol) || 0) * LAMPORTS_PER_SOL;
  const inputs = applyScenario(baseInputs(state.currentEpoch, state.config), scenario);
  const perDay = roundsPerDay(state.previousEpoch);
  const rows = useMemo(() => buildTierRows(inputs, perDay), [inputs, perDay]);

  const targetTier = tierForHub(Number(hubAmount) || 0);
  const boosted = targetTier > 0 ? rows[targetTier - 1] : null;

  const standardPerDay = perDay === null ? null : raw;
  const boostedPerRound = raw + (boosted?.roundLamports ?? 0);
  const boostedPerDay =
    perDay === null || boosted?.dailyLamports == null ? null : raw + boosted.dailyLamports;
  const upliftPct =
    boosted && boostedPerDay != null && standardPerDay != null && standardPerDay > 0
      ? Math.round(((boostedPerDay - standardPerDay) / standardPerDay) * 100)
      : null;

  const basis = `round size ${fmtSol(inputs.roundInflowLamports)} · Σw ${fmtNum(inputs.totalWeightBp)} bp`;
  const cadence =
    perDay === null
      ? "day/week/month need a closed round to infer cadence — none yet."
      : `cadence ≈ ${perDay.toFixed(1)} rounds/day (from the last closed round); day/week/month extrapolate linearly.`;

  return (
    <Panel
      title="EARNING PREVIEW"
      right={<ScenarioToggle value={scenario} onChange={setScenario} />}
    >
      <div className="mb-2 text-[10px] text-amber-400/90">{ESTIMATE_LABEL}</div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {rawDeskDailyLamports === undefined && (
          <RawDeskInput valueSol={rawSol} onChange={setRawSol} />
        )}
        <label className="flex items-center gap-2 text-[10px] text-green-600">
          $HUB to activate with
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="1000"
            value={hubAmount}
            onChange={(e) => setHubAmount(e.target.value)}
            className="w-28 border border-green-500/30 bg-black px-1 py-0.5 text-right text-xs text-green-300 outline-none focus:border-green-400"
          />
          HUB
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="border border-green-500/20 p-2">
          <div className="text-[10px] uppercase tracking-widest text-green-600">STANDARD YIELD</div>
          <div className="mt-1 text-[10px] text-green-700">
            raw desk NFT · not activated · 0.00x
          </div>
          <ProjectionRows perRound={0} perDay={standardPerDay} />
        </div>

        <div className="border border-cyan-500/30 p-2">
          <div className="text-[10px] uppercase tracking-widest text-cyan-400">BOOSTED YIELD</div>
          <div className="mt-1 text-[10px] text-green-700">
            {targetTier > 0 ? (
              <>
                {TIER_NAMES[targetTier - 1]} · {fmtWeight(TIER_WEIGHTS_BP[targetTier - 1])} ·{" "}
                {fmtNum(Math.floor(Number(hubAmount) || 0))} $HUB burned
              </>
            ) : (
              "not enough $HUB for T1 TRADER activation (100,000 $HUB minimum)"
            )}
          </div>
          {targetTier > 0 ? (
            <ProjectionRows perRound={boostedPerRound} perDay={boostedPerDay} />
          ) : (
            <div className="mt-2 text-xs text-green-700">— raise the $HUB amount above —</div>
          )}
          {upliftPct !== null && (
            <div className="mt-1 text-[10px] text-amber-400">+{upliftPct}% vs standard yield</div>
          )}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-green-700">
        <div>{basis}</div>
        <div>burn slice removed before distribution · {cadence}</div>
      </div>
    </Panel>
  );
}
