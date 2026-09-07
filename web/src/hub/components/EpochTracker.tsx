import {
  ACC_SCALE,
  TIER_NAMES,
  TIER_WEIGHTS_BP,
  canFinalize,
  dustCarryLamports,
  effectiveInflowLamports,
  lamportsToThreshold,
  roundProgress,
  type ConfigView,
  type EpochView,
  type ProtocolState,
} from "@hub-sdk";
import { fmtDuration, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { distributableLamports } from "../lib/yield";
import { Panel, Row } from "./ui/Panel";

function ProgressBar({ value }: { value: number }) {
  const cells = 32;
  const filled = Math.round(Math.min(1, value) * cells);
  const bar = `[${"█".repeat(filled)}${"░".repeat(cells - filled)}] ${Math.round(value * 100)}%`;
  return <div className="my-2 text-xs tracking-tighter text-green-500">{bar}</div>;
}

function CurrentRound({ e, config }: { e: EpochView; config: ConfigView }) {
  const effective = effectiveInflowLamports(e, config);
  const carry = dustCarryLamports(config);
  const dist = distributableLamports(effective, config.burnPctBp);
  const ready = canFinalize(e, config);
  const need = lamportsToThreshold(e, config);
  const status = ready
    ? "READY TO CLOSE"
    : config.totalWeightBp === 0
      ? "NO STAKERS"
      : `${fmtSol(need)} to go`;
  return (
    <Panel title={`ROUND #${fmtNum(e.index)} · OPEN`} right={status}>
      <ProgressBar value={roundProgress(e, config)} />
      <Row k="threshold" v={fmtSol(config.minPotThresholdLamports, 2)} />
      <Row k="booked inflow" v={fmtSol(e.inflowLamports)} />
      {carry > 0 && <Row k="+ dust carry" v={`${fmtNum(carry)} lamports`} />}
      <Row k="→ burn slice" v={fmtSol(effective - dist)} />
      <Row k="→ to stakers" v={fmtSol(dist)} />
      <Row k="opened" v={fmtUtc(e.startTs)} />
      <div className="mt-2 text-[10px] text-green-700">
        No clock: finalize_epoch is rejected below threshold and allowed the moment it is met. Σw
        snapshots at close.
      </div>
    </Panel>
  );
}

function PreviousRound({ e }: { e: EpochView | null }) {
  if (!e) {
    return (
      <Panel title="LAST CLOSED ROUND">
        <div className="text-xs text-green-700">none yet — genesis round is still open.</div>
      </Panel>
    );
  }
  const took = e.finalizedTs > e.startTs ? fmtDuration(e.finalizedTs - e.startTs) : "—";
  const perTier = TIER_WEIGHTS_BP.map(
    (w, i) => `${TIER_NAMES[i]} ${fmtSol(Number((e.perWeightScaled * BigInt(w)) / ACC_SCALE), 4)}`,
  ).join(" · ");
  return (
    <Panel title={`ROUND #${fmtNum(e.index)} · CLOSED`} right={`took ${took}`}>
      <Row k="closed" v={fmtUtc(e.finalizedTs)} />
      <Row k="inflow" v={fmtSol(e.inflowLamports)} />
      <Row k="credited to stakers" v={fmtSol(e.distributedLamports)} />
      <Row k="burn pending" v={fmtSol(e.burnPendingLamports)} />
      <Row k="floor remainder" v={`${fmtNum(e.rolledForwardLamports)} lamports → next round`} />
      <Row k="Σw at close" v={`${fmtNum(e.totalWeightBp)} bp`} />
      <div className="mt-2 text-[10px] text-green-700">
        paid per desk: {perTier} — claimable together with every other closed round in one tx.
      </div>
    </Panel>
  );
}

/** §C3/§C4 supporting view — where the open round stands against the threshold and what the last one paid. */
export function EpochTracker({ state }: { state: ProtocolState }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <CurrentRound e={state.currentEpoch} config={state.config} />
      <PreviousRound e={state.previousEpoch} />
    </div>
  );
}
