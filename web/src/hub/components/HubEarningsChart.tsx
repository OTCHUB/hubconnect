import { useMemo } from "react";
import { useHubHistory } from "../hooks/useHubHistory";
import { fmtCompact } from "../lib/format";
import { LineChart } from "./ui/LineChart";
import { Panel } from "./ui/Panel";

/**
 * TVL & yield trend — treasury SOL balance (TVL proxy) vs cumulative $HUB reward distributed to
 * active desk holders, sourced from the Supabase-mirrored snapshot history (see
 * `web/src/hub/lib/supabaseHistory.ts`). Mirrors otchub's `EarningsChart.jsx` role for this
 * module: purely additive trend context around `useTreasuryPortfolio`'s live numbers.
 */
export function HubEarningsChart() {
  const q = useHubHistory();
  const points = q.data ?? [];

  const { labels, treasurySol, rewardDistributed } = useMemo(() => {
    const labels = points.map((p) =>
      new Date(p.t).toLocaleDateString([], { month: "short", day: "2-digit", timeZone: "UTC" }),
    );
    const treasurySol = points.map((p) => p.tvlSol);
    const rewardDistributed = points.map((p) => p.distributedHub);
    return { labels, treasurySol, rewardDistributed };
  }, [points]);

  if (q.isPending) {
    return (
      <Panel title="TVL & YIELD :: TREND">
        <div className="text-xs text-green-700">loading…</div>
      </Panel>
    );
  }
  if (!points.length) {
    return (
      <Panel title="TVL & YIELD :: TREND">
        <div className="text-xs text-green-700">
          no snapshot history yet — the ingest cron (scripts/hub-snapshot-ingest.ts) populates this
          once it has run at least once on this cluster.
        </div>
      </Panel>
    );
  }

  const latest = points[points.length - 1];
  return (
    <Panel title="TVL & YIELD :: TREND" right={`${points.length} snapshot(s)`}>
      <div className="mb-2 text-[11px] text-green-500/40">
        treasury SOL balance (left) vs cumulative $HUB reward distributed to active desk holders
        (right) · daily snapshots
      </div>
      <LineChart
        labels={labels}
        series={[
          {
            id: "treasury",
            label: "TREASURY_SOL",
            color: "#4ade80",
            axis: "left",
            points: treasurySol,
            format: (v) => `${v.toFixed(3)} SOL`,
          },
          {
            id: "reward",
            label: "REWARD_DISTRIBUTED",
            color: "#f59e0b",
            axis: "right",
            points: rewardDistributed,
            format: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} $HUB`,
          },
        ]}
      />
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="text-green-600">
          latest treasury <span className="text-green-300">{latest.tvlSol.toFixed(3)} SOL</span>
        </div>
        <div className="text-right text-green-600">
          reward distributed{" "}
          <span className="text-amber-300">{fmtCompact(latest.distributedHub)} $HUB</span>
        </div>
      </div>
    </Panel>
  );
}
