// Historical dashboard feed — mirrors otchub's src/lib/dashboardFeed.js pattern (QUOTA-safe,
// zero-dependency): a `scripts/hub-snapshot-ingest.ts` cron (every 6h, see
// .github/workflows/snapshot-ingest.yml) inserts one row per cluster into the project's own
// Supabase table, and the browser reads the series DIRECTLY with a single anon-key REST call —
// no RPC fan-out per visitor, no backend of our own to run (hubconnect has no Base44-style
// server; unlike otchub there is no live-function fallback, so an unreachable/unprovisioned
// Supabase simply means "no history yet" and callers fall back to on-chain-only display).
//
// Table shape: supabase/migrations/0001_hub_dashboard.sql — one row per snapshot (not a JSONB
// blob), so Postgres accumulates the series natively and this module just filters/orders it.
//   RLS: public SELECT for the anon key; INSERT only via the service-role key
//   (scripts/hub-snapshot-ingest.ts), matching otchub/base44/shared/supabaseDashboard.ts.

/** One row of `hub_dashboard` — everything a chart needs, nothing that needs a live RPC. */
export type HubHistoryPoint = {
  /** Unix ms this snapshot was taken (from the row's `created_at`). */
  t: number;
  /** Treasury SOL balance — TVL proxy. */
  tvlSol: number;
  /** Cumulative $HUB reward distributed to active desk holders (whole tokens). */
  distributedHub: number;
  /** Live Core desk-collection size (total desks minted network-wide). */
  deskCount: number;
  /** $HUB circulating supply (whole tokens). */
  circulatingHub: number;
};

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const TTL_MS = 60_000; // client-side cache; the ingest cron itself only writes every 6h
const MAX_ROWS = 500; // ~a year+ at one point/6h, bounded so the payload stays small

// One in-memory cache per cluster, shared by every caller on the page.
const cache = new Map<string, { at: number; points: HubHistoryPoint[] }>();

type HubDashboardRow = {
  created_at: string;
  tvl_sol: number;
  distributed_hub: number;
  desk_count: number;
  circulating_hub: number;
};

async function fromSupabase(cluster: string): Promise<HubHistoryPoint[]> {
  const qs = new URLSearchParams({
    select: "created_at,tvl_sol,distributed_hub,desk_count,circulating_hub",
    cluster: `eq.${cluster}`,
    order: "created_at.asc",
    limit: String(MAX_ROWS),
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hub_dashboard?${qs.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase read ${res.status}`);
  const rows = (await res.json()) as HubDashboardRow[];
  return rows.map((r) => ({
    t: new Date(r.created_at).getTime(),
    tvlSol: r.tvl_sol,
    distributedHub: r.distributed_hub,
    deskCount: r.desk_count,
    circulatingHub: r.circulating_hub,
  }));
}

/**
 * Returns the historical series for `cluster`, or `null` when Supabase isn't configured/reachable
 * (e.g. local dev without env vars, or before the first ingest run) — callers treat `null` as "no
 * history available yet", never as an error to surface.
 */
export async function fetchHubHistory(
  cluster: string,
  { force = false }: { force?: boolean } = {},
): Promise<HubHistoryPoint[] | null> {
  const cached = cache.get(cluster);
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.points;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const points = await fromSupabase(cluster);
    cache.set(cluster, { at: Date.now(), points });
    return points;
  } catch {
    return null;
  }
}
