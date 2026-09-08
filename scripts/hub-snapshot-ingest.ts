// Historical-metrics ingest — mirrors otchub's base44/shared/dashboardAggregate.ts +
// supabaseDashboard.ts, adapted for hubconnect's read-only SDK (no Base44 backend here: this
// script IS the ingest, meant to run from cron/CI on a schedule — see
// .github/workflows/snapshot-ingest.yml, every 6h + workflow_dispatch).
//
//   HUB_CLUSTER=mainnet-beta npx ts-node -T scripts/hub-snapshot-ingest.ts   # default cluster
//   HUB_CLUSTER=devnet npx ts-node -T scripts/hub-snapshot-ingest.ts
//
// Read-only: no wallet/signer needed (uses the SDK's `createReader`, same as the web dashboard).
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS for the insert;
// the browser only ever holds the anon key — see web/src/hub/lib/supabaseHistory.ts).
//
// Table schema: supabase/migrations/0001_hub_dashboard.sql. One row per run — Postgres
// accumulates the series natively, keyed by `cluster` so devnet cycles never pollute mainnet
// history, indexed on (cluster, created_at) for the chart queries' access pattern.
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  createReader,
  fetchCollectionCounts,
  fetchProtocolState,
  fetchTokenomics,
  HUB_DECIMALS,
  LAMPORTS_PER_SOL,
} from "../sdk/src";
import { devnetRpc } from "./lib/devnet";
import { mainnetRpc, redactRpc } from "./lib/mainnet";

const cluster = process.env.HUB_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";

/** Mirrors the `hub_dashboard` columns 1:1 — see supabase/migrations/0001_hub_dashboard.sql. */
type HubDashboardRow = {
  cluster: string;
  tvl_sol: number;
  distributed_hub: number;
  desk_count: number;
  circulating_hub: number;
};

async function buildRow(connection: Connection): Promise<HubDashboardRow> {
  const program = createReader(connection);
  const [state, tokenomics] = await Promise.all([
    fetchProtocolState(program),
    fetchTokenomics(program),
  ]);
  const treasury = new PublicKey(state.config.treasury);
  const [collection, treasurySolLamports] = await Promise.all([
    fetchCollectionCounts(connection, new PublicKey(state.config.deskCollection)).catch(() => null),
    connection.getBalance(treasury, "confirmed"),
  ]);

  return {
    cluster,
    tvl_sol: treasurySolLamports / LAMPORTS_PER_SOL,
    distributed_hub: Number(tokenomics?.rewardDistributedUnits ?? 0n) / 10 ** HUB_DECIMALS,
    // Live Core collection size (total desks minted network-wide), falling back to the
    // treasury's own desk count if the collection account is briefly unreadable at ingest time.
    desk_count: collection?.currentSize ?? state.treasury.desksOwned,
    circulating_hub: Number(state.supply.circulatingUnits) / 10 ** HUB_DECIMALS,
  };
}

async function insertRow(url: string, serviceKey: string, row: HubDashboardRow) {
  const res = await fetch(`${url}/rest/v1/hub_dashboard`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok)
    throw new Error(`supabase insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to ingest into");
  }
  const rpc = cluster === "devnet" ? devnetRpc() : mainnetRpc();
  console.info(`[ingest] cluster=${cluster} rpc=${redactRpc(rpc)}`);
  const connection = new Connection(rpc, "confirmed");
  const row = await buildRow(connection);
  await insertRow(url, serviceKey, row);
  console.info(`[ingest] wrote row for cluster=${cluster}: ${JSON.stringify(row)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
