import type { HubCluster } from "./hub";

// Standalone-shell config only; otchub passes its own values as HubProvider props.
const CLUSTERS: HubCluster[] = ["devnet", "mainnet-beta", "localnet"];

const cluster = (import.meta.env.VITE_HUB_CLUSTER ?? "devnet") as HubCluster;

export const shellConfig = {
  rpcUrl: import.meta.env.VITE_HUB_RPC_URL ?? "https://api.devnet.solana.com",
  programId: import.meta.env.VITE_HUB_PROGRAM_ID || undefined,
  cluster: CLUSTERS.includes(cluster) ? cluster : "devnet",
};

/** Root path this standalone shell mounts `HubRoutes` under — `otchub.dev/hub` for the
 *  mainnet-beta build, `otchub.dev/devnet` for the devnet build (see `../wrangler.jsonc`'s
 *  routes and `vite.config.ts`'s `base`, both keyed off the same `--mode devnet` flag). `/drip`
 *  (devnet-only) stays a fixed top-level path in `App.tsx`, independent of this. otchub's own
 *  router will pass an equivalent prefix when it mounts `<HubRoutes>`/`<DripPage>` directly
 *  instead of this shell. */
export const HUB_BASE = import.meta.env.MODE === "devnet" ? "/devnet" : "/hub";
