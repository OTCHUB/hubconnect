import {
  canFinalize,
  effectiveInflowLamports,
  lamportsToThreshold,
  roundProgress,
  type ProtocolState,
} from "@hub-sdk";
import { fmtBp, fmtNum, fmtSol } from "../lib/format";
import { Stat } from "./ui/Panel";

/** §C3 — live metrics strip across the top of the panel. */
export function MetricsStrip({ state }: { state: ProtocolState }) {
  const { config, currentEpoch, potLamports, burn } = state;
  const surplus = potLamports - config.potLiabilityLamports;
  const pct = Math.round(roundProgress(currentEpoch, config) * 100);
  const ready = canFinalize(currentEpoch, config);

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
      <Stat label="pot balance" value={fmtSol(potLamports)} sub="system PDA lamports" />
      <Stat
        label="pot liability"
        value={fmtSol(config.potLiabilityLamports)}
        sub={
          <span className={surplus < 0 ? "text-red-400" : undefined}>
            surplus {fmtSol(surplus)}
          </span>
        }
      />
      <Stat
        label="round"
        value={`#${fmtNum(currentEpoch.index)}`}
        sub={
          ready ? (
            <span className="text-green-400">ready to close · {pct}%</span>
          ) : (
            `${pct}% of ${fmtSol(config.minPotThresholdLamports, 2)} · ${fmtSol(lamportsToThreshold(currentEpoch, config))} to go`
          )
        }
      />
      <Stat
        label="round inflow"
        value={fmtSol(effectiveInflowLamports(currentEpoch, config))}
        sub={`burn slice ${fmtBp(config.burnPctBp, 0)}`}
      />
      <Stat
        label="Σ weight"
        value={`${(config.totalWeightBp / 10_000).toFixed(2)} w`}
        sub={`${fmtNum(config.totalWeightBp)} bp active`}
      />
      <Stat
        label="$HUB burned"
        value={fmtNum(burn.totalHubBurned)}
        sub={`pending ${fmtSol(burn.burnPendingLamports)}`}
      />
    </div>
  );
}
