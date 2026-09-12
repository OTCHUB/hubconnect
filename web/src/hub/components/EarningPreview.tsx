import { useMemo, useState } from "react";
import { LAMPORTS_PER_SOL, TIER_NAMES, type ProtocolState } from "@hub-sdk";
import { fmtNum, fmtSol, fmtTokens, fmtWeight } from "../lib/format";
import {
  baseInputs,
  buildTierRows,
  DEFAULT_RAW_DESK_DAILY_LAMPORTS,
  DEFAULT_RAW_DESK_SOL,
  roundsPerDay,
} from "../lib/yield";
import { RawDeskInput } from "./RawDeskInput";
import { Panel, Row } from "./ui/Panel";

export const ESTIMATE_LABEL = "ESTIMATE — scales with Σw; not a promise";

type Props = {
  state: ProtocolState;
  /** Host-supplied baseline (otchub knows live desk-pot revenue); when omitted, defaults to the
   *  §A5 protocol-average raw desk-pot take (`DEFAULT_RAW_DESK_DAILY_LAMPORTS`), overridable via
   *  the optional input. */
  rawDeskDailyLamports?: number;
};

const NON_CUSTODIAL_HINT =
  "Non-custodial activation: burning $HUB into a tier never moves, locks, or delegates your desk NFT — it stays in your wallet. There is no protocol escrow or vault. Transfer or sell the desk and the tier is revoked on next claim.";

/** §C4 — automated, data-driven earnings simulation against the live `ProtocolState` (round
 *  size, Σw, burn slice — see ../lib/yield.ts). No manual input required: the raw-desk baseline
 *  defaults to the §A5 protocol-average take (`DEFAULT_RAW_DESK_DAILY_LAMPORTS`), and every
 *  tier's HUB Protocol Boost is precomputed from `buildTierRows`. Click a tier row to select it
 *  for the summary below: Native Desk Yield + HUB Protocol Boost = Total Combined. Day/week/
 *  month figures only ever come from a real closed round (`roundsPerDay` refuses to extrapolate
 *  from an implausibly fast round — see `MIN_REALISTIC_ROUND_SECS`); until one exists, only the
 *  /round figure is shown — never a fabricated day-rate. */
export function EarningPreview({ state, rawDeskDailyLamports }: Props) {
  // Pre-filled with the §A5 protocol-average raw desk-pot take (0.1443 SOL/day) — no mandatory
  // manual entry; the input only exists to let a user override the default with their own desk's
  // live take.
  const [rawSol, setRawSol] = useState(String(DEFAULT_RAW_DESK_SOL));
  // Which tier's summary is shown below the comparison table — click any row to change it.
  const [selectedTier, setSelectedTier] = useState(1);

  const raw =
    rawDeskDailyLamports ??
    (rawSol.trim() === ""
      ? DEFAULT_RAW_DESK_DAILY_LAMPORTS
      : Math.max(0, Number(rawSol) || 0) * LAMPORTS_PER_SOL);
  const inputs = baseInputs(state.currentEpoch, state.config);
  const perDay = roundsPerDay(state.previousEpoch);
  // §HUB burn tracks the live on-chain price cache (cheaper than the genesis ceiling once fresh
  // — see `liveHubCostUnits`), not a static lookup, so `state.config` + a fresh `now` feed in.
  const rows = useMemo(
    () => buildTierRows(inputs, perDay, state.config, Math.floor(Date.now() / 1000), state.tierFee),
    [inputs, perDay, state.config, state.tierFee],
  );
  const selected = rows[selectedTier - 1] ?? rows[0];

  // Native Yield always has a day rate — it accrues from the desk pot continuously, independent
  // of HUB Pot round closes. HUB Protocol Boost (and the combined Total) only resolve to a
  // day rate once a trustworthy round cadence exists (perDay !== null).
  const totalDaily = selected.dailyLamports == null ? null : raw + selected.dailyLamports;
  const upliftPct =
    totalDaily != null && raw > 0 ? Math.round(((totalDaily - raw) / raw) * 100) : null;

  const basis = `round ${fmtSol(inputs.roundInflowLamports)} SOL · Σw ${fmtNum(inputs.totalWeightBp)} bp`;
  const cadence =
    perDay === null
      ? "day/week/month need a longer closed-round history to project safely — /round only for now."
      : `≈ ${perDay.toFixed(1)} rounds/day, from the last closed round.`;
  const boostValue =
    selected.dailyLamports == null
      ? `${fmtSol(selected.roundLamports, 4)} SOL / round`
      : `${fmtSol(selected.dailyLamports, 4)} SOL/day (${fmtSol(selected.roundLamports, 4)}/round)`;
  const totalValue =
    totalDaily == null
      ? `${fmtSol(raw, 4)} SOL/day native-only — boost pending real cadence`
      : `${fmtSol(totalDaily, 4)} SOL/day${upliftPct !== null ? ` (+${upliftPct}%)` : ""}`;

  return (
    <Panel title="EARNING PREVIEW" right={basis}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-amber-400/90">{ESTIMATE_LABEL}</span>
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
                  <td className="px-1 py-1 text-right">{fmtTokens(r.hubCostUnits)}</td>
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

      {/* Compact decomposition for the selected tier: Native + Boost = Total. */}
      <div className="mt-3">
        <Row k="NATIVE DESK YIELD" v={`${fmtSol(raw, 4)} SOL/day`} />
        <Row
          k={
            <span className="flex items-center gap-1">
              HUB PROTOCOL BOOST · {TIER_NAMES[selected.tier - 1]}
              <span className="cursor-help text-cyan-600" title={NON_CUSTODIAL_HINT}>
                ⓘ
              </span>
            </span>
          }
          v={boostValue}
        />
        <Row k="TOTAL COMBINED" v={totalValue} />
      </div>

      <div className="mt-2 text-[10px] text-green-700">
        <div>burn slice removed before distribution · {cadence}</div>
        <div className="mt-1">
          $HUB BURN is a live, USD-pegged price — only {(state.config.tierCostBurnBp / 100).toFixed(0)}
          % of it is destroyed; the rest credits the active-desk reward pool (not reflected above).
        </div>
        <div className="mt-1 text-cyan-700">
          non-custodial — your desk NFT never leaves your wallet.
        </div>
      </div>
    </Panel>
  );
}
