import { epochProgress, type ProtocolState } from "@hub-sdk";
import { useNow } from "../hooks/useNow";
import { fmtBp, fmtCountdown, fmtNum, fmtSol } from "../lib/format";
import { Stat } from "./ui/Panel";

/** §C3 — live metrics strip across the top of the panel. */
export function MetricsStrip({ state }: { state: ProtocolState }) {
  const now = useNow();
  const { config, currentEpoch, potLamports, burn } = state;
  const surplus = potLamports - config.potLiabilityLamports;
  const pct = Math.round(epochProgress(currentEpoch, now) * 100);

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
        label="epoch"
        value={`#${fmtNum(currentEpoch.index)}`}
        sub={`${fmtCountdown(currentEpoch.endTs, now)} left · ${pct}%`}
      />
      <Stat
        label="epoch inflow"
        value={fmtSol(currentEpoch.inflowLamports)}
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
