import {
  canFinalize,
  dustCarryLamports,
  effectiveInflowLamports,
  lamportsToThreshold,
  roundProgress,
  type ConfigView,
  type EpochView,
  type ProtocolState,
} from "@hub-sdk";
import { fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { distributableLamports } from "../lib/yield";
import { RoundsList } from "./RoundsList";
import { Panel, Row } from "./ui/Panel";
import { ProgressBar } from "./ui/ProgressBar";

function CurrentRound({ e, config }: { e: EpochView; config: ConfigView }) {
  const effective = effectiveInflowLamports(e, config);
  const carry = dustCarryLamports(config);
  const dist = distributableLamports(
    effective,
    config.burnPctBp,
    config.lpPctBp,
    config.treasuryFloatPctBp,
  );
  const ready = canFinalize(e, config);
  const need = lamportsToThreshold(e, config);
  const status = ready
    ? "READY TO CLOSE"
    : config.totalWeightBp === 0
      ? "NO STAKERS"
      : `${fmtSol(need)} to go`;
  return (
    <Panel title={`ROUND #${fmtNum(e.index)} · OPEN`} right={status}>
      <ProgressBar frac={roundProgress(e, config)} suffix="to threshold" />
      <Row k="threshold" v={fmtSol(config.minPotThresholdLamports, 2)} />
      <Row k="booked inflow" v={fmtSol(e.inflowLamports)} />
      {carry > 0 && <Row k="+ dust carry" v={`${fmtNum(carry)} lamports`} />}
      <Row k="→ burn + LP + float" v={fmtSol(effective - dist)} />
      <Row k="→ to stakers" v={fmtSol(dist)} />
      <Row k="opened" v={fmtUtc(e.startTs)} />
      <div className="mt-2 text-[10px] text-green-700">
        No clock: finalize_epoch is rejected below threshold and allowed the moment it is met. Σw
        snapshots at close.
      </div>
    </Panel>
  );
}

/** §C3/§C4 supporting view — where the open round stands against the threshold, plus the full
 * closed-round history as an expandable list (newest first). */
export function EpochTracker({ state }: { state: ProtocolState }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <CurrentRound e={state.currentEpoch} config={state.config} />
      <RoundsList config={state.config} />
    </div>
  );
}
