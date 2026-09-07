import { epochProgress, type EpochView, type ProtocolState } from "@hub-sdk";
import { useNow } from "../hooks/useNow";
import { fmtCountdown, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { distributableLamports } from "../lib/yield";
import { Panel, Row } from "./ui/Panel";

function ProgressBar({ value }: { value: number }) {
  const cells = 32;
  const filled = Math.round(value * cells);
  const bar = `[${"█".repeat(filled)}${"░".repeat(cells - filled)}] ${Math.round(value * 100)}%`;
  return <div className="my-2 text-xs tracking-tighter text-green-500">{bar}</div>;
}

function CurrentEpoch({ e, burnPctBp }: { e: EpochView; burnPctBp: number }) {
  const now = useNow();
  const dist = distributableLamports(e.inflowLamports, burnPctBp);
  return (
    <Panel title={`EPOCH #${fmtNum(e.index)} · OPEN`} right={`${fmtCountdown(e.endTs, now)} left`}>
      <ProgressBar value={epochProgress(e, now)} />
      <Row k="start" v={fmtUtc(e.startTs)} />
      <Row k="end" v={fmtUtc(e.endTs)} />
      <Row k="inflow so far" v={fmtSol(e.inflowLamports)} />
      <Row k="→ burn slice" v={fmtSol(e.inflowLamports - dist)} />
      <Row k="→ distributable" v={fmtSol(dist)} />
      <Row k="rolled forward in" v={fmtSol(e.rolledForwardLamports)} />
      <div className="mt-2 text-[10px] text-green-700">
        Σw snapshots at close; projections below assume the live cohort.
      </div>
    </Panel>
  );
}

function PreviousEpoch({ e }: { e: EpochView | null }) {
  if (!e) {
    return (
      <Panel title="PREVIOUS EPOCH">
        <div className="text-xs text-green-700">none yet — genesis epoch is still open.</div>
      </Panel>
    );
  }
  const unclaimed = e.distributedLamports - e.claimedLamports;
  return (
    <Panel title={`EPOCH #${fmtNum(e.index)} · ${e.finalized ? "FINALIZED" : "CLOSING"}`}>
      <Row k="window" v={`${fmtUtc(e.startTs)} → ${fmtUtc(e.endTs)}`} />
      <Row k="inflow" v={fmtSol(e.inflowLamports)} />
      <Row k="distributed" v={fmtSol(e.distributedLamports)} />
      <Row k="burn pending" v={fmtSol(e.burnPendingLamports)} />
      <Row k="claimed" v={`${fmtSol(e.claimedLamports)} · ${fmtNum(e.claimedWeightBp)} bp`} />
      <Row k="unclaimed" v={fmtSol(unclaimed)} />
      <Row k="Σw at close" v={`${fmtNum(e.totalWeightBp)} bp`} />
    </Panel>
  );
}

/** §C3/§C4 supporting view — where the current epoch stands and what the last one paid. */
export function EpochTracker({ state }: { state: ProtocolState }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <CurrentEpoch e={state.currentEpoch} burnPctBp={state.config.burnPctBp} />
      <PreviousEpoch e={state.previousEpoch} />
    </div>
  );
}
