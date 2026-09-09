import {
  canFinalize,
  effectiveInflowLamports,
  lamportsToThreshold,
  roundProgress,
  type ProtocolState,
} from "@hub-sdk";
import { fmtBp, fmtBpPct, fmtHub, fmtNum, fmtSol } from "../lib/format";
import { Stat } from "./ui/Panel";

/** §C3 — live metrics strip across the top of the panel. */
export function MetricsStrip({ state }: { state: ProtocolState }) {
  const { config, currentEpoch, potLamports, supply } = state;
  const surplus = potLamports - config.potLiabilityLamports;
  const pct = Math.round(roundProgress(currentEpoch, config) * 100);
  const ready = canFinalize(currentEpoch, config);
  const d = supply.decimals;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
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
        value={fmtHub(supply.burnedUnits, d)}
        sub={
          <span className={supply.ledgerDrift ? "text-yellow-500" : undefined}>
            {supply.ledgerDrift
              ? `ledger ${fmtHub(supply.ledgerBurnedUnits, d)} · drift`
              : "ledger synced"}
          </span>
        }
      />
      <Stat
        label="burn % of circ."
        value={
          <span
            className="text-orange-300"
            title="burned ÷ circulating (max − burned − treasury/locked)"
          >
            {fmtBpPct(supply.burnPctOfCirculatingBp)}
          </span>
        }
        sub={
          supply.burnPctOfCirculatingBp == null
            ? `no float yet · ${fmtBpPct(supply.burnPctOfMaxBp)} of ${fmtHub(supply.maxUnits, d, 0)} max burned`
            : `${fmtBpPct(supply.burnPctOfMaxBp)} of ${fmtHub(supply.maxUnits, d, 0)} max`
        }
      />
      <Stat
        label="circulating"
        value={fmtHub(supply.circulatingUnits, d)}
        sub={`locked ${fmtHub(supply.lockedUnits, d)} · treasury + vault`}
      />
    </div>
  );
}
