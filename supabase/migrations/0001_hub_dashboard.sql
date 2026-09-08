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
-- via the service-role key from scripts/hub-snapshot-ingest.ts. `service_role` bypasses RLS
-- entirely, so no INSERT policy is needed — but it still needs the table-level GRANT below (RLS
-- bypass isn't a privilege grant), or the insert fails with 403/42501 "permission denied".
alter table hub_dashboard enable row level security;

create policy "hub_dashboard_public_read" on hub_dashboard
  for select
  to anon, authenticated
  using (true);

-- RLS policies alone are not sufficient: Postgres also requires the table-level privilege grant
-- below, or `anon`/`authenticated` get a bare "permission denied for table hub_dashboard" (42501)
-- before RLS is ever evaluated. Supabase-managed projects don't grant this on new tables by
-- default unless `ALTER DEFAULT PRIVILEGES` was set up beforehand.
grant select on hub_dashboard to anon, authenticated;

-- Same story for the ingest script's writer: `service_role` bypasses RLS but still needs the
-- table-level INSERT grant, or scripts/hub-snapshot-ingest.ts's insert fails with a 403.
grant insert on hub_dashboard to service_role;
