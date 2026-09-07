import type { HubCluster } from "./hub";

// Standalone-shell config only; otchub passes its own values as HubProvider props.
const CLUSTERS: HubCluster[] = ["devnet", "mainnet-beta", "localnet"];

const cluster = (import.meta.env.VITE_HUB_CLUSTER ?? "devnet") as HubCluster;

export const shellConfig = {
  rpcUrl: import.meta.env.VITE_HUB_RPC_URL ?? "https://api.devnet.solana.com",
  programId: import.meta.env.VITE_HUB_PROGRAM_ID || undefined,
  cluster: CLUSTERS.includes(cluster) ? cluster : "devnet",
};
