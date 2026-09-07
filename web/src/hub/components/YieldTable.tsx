import { useState } from "react";
import { LAMPORTS_PER_SOL, TIER_NAMES, type ProtocolState } from "@hub-sdk";
import { fmtNum, fmtSol, fmtWeight } from "../lib/format";
import {
  applyScenario,
  baseInputs,
  buildTierRows,
  roundsPerDay,
  type Scenario,
  type TierRow,
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

const th = "px-2 py-1 text-left text-[10px] uppercase tracking-widest text-green-600";
const td = "px-2 py-1 text-xs text-green-300 whitespace-nowrap";

function TierRowView({ r, raw }: { r: TierRow; raw: number }) {
  const daily = r.dailyLamports;
  const uplift = raw > 0 && daily !== null ? `+${((daily / raw) * 100).toFixed(0)}%` : "—";
  const breakeven = r.breakevenRounds === null ? "—" : `${fmtNum(r.breakevenRounds)} rounds`;
  return (
    <tr className="border-t border-green-500/10">
      <td className={td}>
        <span className="text-green-200">{TIER_NAMES[r.tier - 1]}</span>
        <span className="ml-1 text-green-700">{fmtWeight(r.weightBp)}</span>
      </td>
      <td className={td}>{fmtSol(r.cumulativeFeeLamports, 1)}</td>
      <td className={td}>{fmtSol(r.roundLamports, 4)}</td>
      <td className={td}>{daily === null ? "—" : fmtSol(raw + daily, 4)}</td>
      <td className={td}>{daily === null ? "—" : fmtSol((raw + daily) * 7)}</td>
      <td className={td}>{daily === null ? "—" : fmtSol((raw + daily) * 30)}</td>
      <td className={td}>{uplift}</td>
      <td className={td}>{breakeven}</td>
    </tr>
  );
}

/** §C4 — per-tier projection table with the §C5 scenario toggle. */
export function YieldTable({ state, rawDeskDailyLamports }: Props) {
  const [scenario, setScenario] = useState<Scenario>("current");
  const [rawSol, setRawSol] = useState("0");

  const raw = rawDeskDailyLamports ?? Math.max(0, Number(rawSol) || 0) * LAMPORTS_PER_SOL;
  const inputs = applyScenario(baseInputs(state.currentEpoch, state.config), scenario);
  const perDay = roundsPerDay(state.previousEpoch);
  const rows = buildTierRows(inputs, perDay);
  const toggle = <ScenarioToggle value={scenario} onChange={setScenario} />;
  const basis = `round size ${fmtSol(inputs.roundInflowLamports)} · Σw ${fmtNum(inputs.totalWeightBp)} bp`;
  const cadence =
    perDay === null
      ? "day/week/month need a closed round to infer cadence — none yet."
      : `cadence ≈ ${perDay.toFixed(1)} rounds/day (from the last closed round); day/week/month extrapolate linearly.`;

  return (
    <Panel title="YIELD BY TIER" right={toggle}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] text-amber-400/90">{ESTIMATE_LABEL}</div>
        {rawDeskDailyLamports === undefined && (
          <RawDeskInput valueSol={rawSol} onChange={setRawSol} />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>tier</th>
              <th className={th}>fee (cum.)</th>
              <th className={th}>/ round</th>
              <th className={th}>/ day</th>
              <th className={th}>/ week</th>
              <th className={th}>/ month</th>
              <th className={th}>vs raw</th>
              <th className={th}>breakeven</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-green-500/10">
              <td className={td}>
                <span className="text-green-600">RAW DESK</span>
                <span className="ml-1 text-green-800">0.00x</span>
              </td>
              <td className={td}>—</td>
              <td className={td}>—</td>
              <td className={td}>{fmtSol(raw, 4)}</td>
              <td className={td}>{fmtSol(raw * 7)}</td>
              <td className={td}>{fmtSol(raw * 30)}</td>
              <td className={td}>0%</td>
              <td className={td}>—</td>
            </tr>
            {rows.map((r) => (
              <TierRowView key={r.tier} r={r} raw={raw} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-green-700">
        <div>{basis}</div>
        <div>burn slice removed before distribution · {cadence}</div>
      </div>
    </Panel>
  );
}
