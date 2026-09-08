-- hub_dashboard: one row per snapshot, written by scripts/hub-snapshot-ingest.ts (cron/CI, every
-- 6h — see .github/workflows/snapshot-ingest.yml) and read by
-- web/src/hub/lib/supabaseHistory.ts for the dashboard's trend charts (HubEarningsChart,
-- HubSupplyChart). Postgres accumulates the series natively — no client-side history-array
-- bookkeeping needed, unlike the JSONB-blob approach this replaces.
--
-- Run once against the project's Supabase database (SQL editor or `supabase db push`).
create table if not exists hub_dashboard (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  cluster text not null,
  tvl_sol numeric not null,
  distributed_hub numeric not null,
  desk_count int4 not null,
  circulating_hub numeric not null
);

-- Every read is "latest N points for a cluster, oldest first" — this index covers both the
-- filter (cluster) and the sort (created_at) in one pass.
create index if not exists hub_dashboard_cluster_created_at_idx
  on hub_dashboard (cluster, created_at);

-- RLS: public SELECT for the anon key (charts are read-only, public dashboard data); INSERT only
-- via the service-role key from scripts/hub-snapshot-ingest.ts, which bypasses RLS entirely, so
-- no INSERT policy is needed (and none is granted to anon/authenticated).
alter table hub_dashboard enable row level security;

create policy "hub_dashboard_public_read" on hub_dashboard
  for select
  to anon, authenticated
  using (true);
