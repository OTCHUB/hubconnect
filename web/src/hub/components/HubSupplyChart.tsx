import { useMemo } from "react";
import { useHubHistory } from "../hooks/useHubHistory";
import { fmtCompact, fmtNum } from "../lib/format";
import { MAX_DESK_SUPPLY } from "../lib/yield";
import { LineChart } from "./ui/LineChart";
import { Panel } from "./ui/Panel";

type Props = {
  /** Live Core desk-collection size from `useTokenomics`; `null` if unreadable/not loaded. */
  liveDeskCount: number | null;
  /** Live $HUB circulating supply (whole tokens), read straight off `ProtocolState`. */
  liveCirculatingHub: number | null;
};

/**
 * Supply trend — live Core desk-collection size vs $HUB circulating supply, sourced from the
 * Supabase-mirrored snapshot history with a synthetic "NOW" point appended from live RPC data
 * (`liveDeskCount`/`liveCirculatingHub`, threaded down from `TokenomicsPanel.tsx`) so the chart's
 * edge never lags the page's own "Current" stats by up to the 6h ingest interval. Mirrors
 * otchub's `SupplyChart.jsx` role: desk-mint growth vs token supply drawdown, but for the $HUB
 * buyback-burn model (no per-desk deposit-burn like $OTC — supply only moves via `record_burn`).
 */
export function HubSupplyChart({ liveDeskCount, liveCirculatingHub }: Props) {
  const q = useHubHistory();
  const points = q.data ?? [];
  const hasLive = liveDeskCount != null && liveCirculatingHub != null;

  const { labels, desks, circulating } = useMemo(() => {
    const labels = points.map((p) =>
      new Date(p.t).toLocaleDateString([], { month: "short", day: "2-digit", timeZone: "UTC" }),
    );
    const desks = points.map((p) => p.deskCount);
    const circulating = points.map((p) => p.circulatingHub);
    if (hasLive) {
      labels.push("NOW");
      desks.push(liveDeskCount);
      circulating.push(liveCirculatingHub);
    }
    return { labels, desks, circulating };
  }, [points, hasLive, liveDeskCount, liveCirculatingHub]);

  if (q.isPending) {
    return (
      <Panel title="SUPPLY :: DESK_MINT vs $HUB_CIRCULATING">
        <div className="text-xs text-green-700">loading…</div>
      </Panel>
    );
  }
  if (!points.length) {
    return (
      <Panel title="SUPPLY :: DESK_MINT vs $HUB_CIRCULATING">
        <div className="text-xs text-green-700">
          no snapshot history yet — the ingest cron (scripts/hub-snapshot-ingest.ts) populates this
          once it has run at least once on this cluster.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="SUPPLY :: DESK_MINT vs $HUB_CIRCULATING"
      right={`${points.length} snapshot(s)${hasLive ? " + live" : ""}`}
    >
      <div className="mb-2 text-[11px] text-green-500/40">
        Core desk collection size (left, cap {fmtNum(MAX_DESK_SUPPLY)}) vs $HUB circulating supply
        (right) · historical snapshots (6h interval)
      </div>
      <LineChart
        labels={labels}
        series={[
          {
            id: "desks",
            label: "DESKS",
            color: "#22d3ee",
            axis: "left",
            points: desks,
            format: (v) => fmtNum(v),
          },
          {
            id: "circulating",
            label: "HUB_CIRCULATING",
            color: "#4ade80",
            axis: "right",
            points: circulating,
            format: (v) => `${fmtCompact(v)} $HUB`,
          },
        ]}
      />
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="text-green-600">
          desks{" "}
          <span className="text-cyan-300">
            {fmtNum(liveDeskCount ?? points[points.length - 1].deskCount)}
          </span>
        </div>
        <div className="text-right text-green-600">
          circulating{" "}
          <span className="text-green-300">
            {fmtCompact(liveCirculatingHub ?? points[points.length - 1].circulatingHub)} $HUB
          </span>
        </div>
      </div>
    </Panel>
  );
}
