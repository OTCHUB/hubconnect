import { useMemo, useState } from "react";
import { LAMPORTS_PER_SOL, TIER_HUB_COST_UNITS, TIER_NAMES, type ProtocolState } from "@hub-sdk";
import { fmtNum, fmtSol, fmtTokens, fmtWeight } from "../lib/format";
import {
  applyScenario,
  baseInputs,
  buildTierRows,
  DEFAULT_RAW_DESK_DAILY_LAMPORTS,
  DEFAULT_RAW_DESK_SOL,
  roundsPerDay,
  type Scenario,
} from "../lib/yield";
import { RawDeskInput } from "./RawDeskInput";
import { ScenarioToggle } from "./ScenarioToggle";
import { Panel } from "./ui/Panel";

export const ESTIMATE_LABEL = "ESTIMATE — scales with Σw; not a promise";

type Props = {
  state: ProtocolState;
  /** Host-supplied baseline (otchub knows live desk-pot revenue); when omitted, defaults to the
   *  §A5 protocol-average raw desk-pot take (`DEFAULT_RAW_DESK_DAILY_LAMPORTS`), overridable via
   *  the optional input. */
  rawDeskDailyLamports?: number;
};

/** Round-based projection: /round, /day, /week, /month. Used for HUB Protocol Boost, which only
 *  exists at round-close cadence. */
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

/** Continuous-accrual projection: /day, /week, /month only — no round concept. Used for Native
 *  Desk Yield (accrues from the desk-pot continuously, not gated by HUB Pot round closes) and for
 *  the combined Total, which is always defined once a daily rate exists. */
function DailyProjection({ perDay }: { perDay: number | null }) {
  return (
    <div className="mt-2 space-y-0.5 text-xs">
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

/** §C4 — automated, data-driven earnings simulation. Shows every T1–T4 activation tier at a
 *  glance against the live `ProtocolState` (round size, Σw, burn slice from ../lib/yield.ts), with
 *  no mandatory manual input: the raw-desk baseline defaults to the §A5 protocol-average take
 *  (`DEFAULT_RAW_DESK_DAILY_LAMPORTS`) and every tier's HUB Protocol Boost is precomputed from
 *  `buildTierRows`. Clicking a tier row expands its full decomposition — Native Desk Yield (the
 *  raw baseline) + HUB Protocol Boost (tier weight / Σw × round inflow) = Total Combined — with
 *  daily/weekly/monthly projections for the total. */
export function EarningPreview({ state, rawDeskDailyLamports }: Props) {
  const [scenario, setScenario] = useState<Scenario>("current");
  // Pre-filled with the §A5 protocol-average raw desk-pot take (0.1443 SOL/day) — no mandatory
  // manual entry; the input only exists to let a user override the default with their own desk's
  // live take.
  const [rawSol, setRawSol] = useState(String(DEFAULT_RAW_DESK_SOL));
  // Which tier's breakdown is expanded below the comparison table — click any row to change it.
  const [selectedTier, setSelectedTier] = useState(1);

  const raw =
    rawDeskDailyLamports ??
    (rawSol.trim() === ""
      ? DEFAULT_RAW_DESK_DAILY_LAMPORTS
      : Math.max(0, Number(rawSol) || 0) * LAMPORTS_PER_SOL);
  const inputs = applyScenario(baseInputs(state.currentEpoch, state.config), scenario);
  const perDay = roundsPerDay(state.previousEpoch);
  const rows = useMemo(() => buildTierRows(inputs, perDay), [inputs, perDay]);
  const selected = rows[selectedTier - 1] ?? rows[0];

  // Native Yield always has a day/week/month rate — it accrues from the desk pot continuously,
  // independent of HUB Pot round closes. HUB Protocol Boost only resolves to day/week/month once
  // a round cadence is known (perDay !== null); the combined Total inherits that same gate.
  const totalDaily = selected.dailyLamports == null ? null : raw + selected.dailyLamports;
  const upliftPct =
    totalDaily != null && raw > 0 ? Math.round(((totalDaily - raw) / raw) * 100) : null;

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] text-green-600">{basis}</div>
        {rawDeskDailyLamports === undefined && (
          <RawDeskInput valueSol={rawSol} onChange={setRawSol} />
        )}
      </div>

      {/* Tiered comparison — every T1–T4 activation at a glance, no manual $HUB entry required. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-green-500/30 text-green-600">
              <th className="px-1 py-1 text-left">TIER</th>
              <th className="px-1 py-1 text-right">WEIGHT</th>
              <th className="px-1 py-1 text-right">$HUB BURN</th>
              <th className="px-1 py-1 text-right">BOOST / day</th>
              <th className="px-1 py-1 text-right">TOTAL / day</th>
              <th className="px-1 py-1 text-right">VS RAW</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const totalDay = r.dailyLamports == null ? null : raw + r.dailyLamports;
              const uplift =
                totalDay != null && raw > 0 ? Math.round(((totalDay - raw) / raw) * 100) : null;
              const on = r.tier === selectedTier;
              return (
                <tr
                  key={r.tier}
                  onClick={() => setSelectedTier(r.tier)}
                  className={`cursor-pointer border-b border-green-500/10 ${
                    on ? "bg-cyan-500/10 text-cyan-300" : "text-green-400 hover:bg-green-500/5"
                  }`}
                >
                  <td className="px-1 py-1">
                    ({on ? "●" : " "}) {TIER_NAMES[r.tier - 1]}
                  </td>
                  <td className="px-1 py-1 text-right">{fmtWeight(r.weightBp)}</td>
                  <td className="px-1 py-1 text-right">
                    {fmtTokens(TIER_HUB_COST_UNITS[r.tier - 1])}
                  </td>
                  <td className="px-1 py-1 text-right">
                    {r.dailyLamports == null ? "—" : fmtSol(r.dailyLamports, 4)}
                  </td>
                  <td className="px-1 py-1 text-right">
                    {totalDay == null ? "—" : fmtSol(totalDay, 4)}
                  </td>
                  <td className="px-1 py-1 text-right text-amber-400">
                    {uplift == null ? "—" : `+${uplift}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Yield decomposition for the selected tier: Native Desk Yield + HUB Protocol Boost = Total. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="border border-green-500/20 p-2">
          <div className="text-[10px] uppercase tracking-widest text-green-600">
            NATIVE DESK YIELD
          </div>
          <div className="mt-1 text-[10px] text-green-700">
            raw desk-pot take · un-activated baseline
          </div>
          <DailyProjection perDay={raw} />
        </div>

        <div className="border border-cyan-500/30 p-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-cyan-400">
            HUB PROTOCOL BOOST
            <span
              className="cursor-help text-cyan-600"
              title="Non-custodial activation: burning $HUB into a tier never moves, locks, or delegates your desk NFT. It stays in your wallet the whole time — activate_tier only verifies ownership and burns $HUB; there is no protocol escrow or vault holding user desks. Transfer or sell the desk and the tier is revoked on next claim (see section 1)."
            >
              ⓘ
            </span>
          </div>
          <div className="mt-1 text-[10px] text-green-700">
            {TIER_NAMES[selected.tier - 1]} · {fmtWeight(selected.weightBp)} ·{" "}
            {fmtTokens(TIER_HUB_COST_UNITS[selected.tier - 1])} $HUB burned
          </div>
          <ProjectionRows perRound={selected.roundLamports} perDay={selected.dailyLamports} />
        </div>

        <div className="border border-amber-500/30 p-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">TOTAL COMBINED</div>
          <div className="mt-1 text-[10px] text-green-700">
            native + boost · {TIER_NAMES[selected.tier - 1]}
          </div>
          <DailyProjection perDay={totalDaily} />
          {upliftPct !== null && (
            <div className="mt-1 text-[10px] text-amber-400">
              +{upliftPct}% vs native-only yield
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-green-700">
        <div>burn slice removed before distribution · {cadence}</div>
        <div className="mt-1 text-cyan-700">
          non-custodial — activation only burns $HUB and verifies ownership; your desk NFT never
          leaves your wallet or moves into a protocol escrow/vault.
        </div>
      </div>
    </Panel>
  );
}
