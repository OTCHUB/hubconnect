import { useQuery } from "@tanstack/react-query";
import { useHub } from "../HubProvider";
import type { HubCluster } from "../lib/explorer";

/** Genesis hashes identify the network regardless of which RPC host serves it. */
const GENESIS: Record<string, HubCluster> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
};

export type RpcClusterStatus =
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "known"; cluster: HubCluster; matches: boolean }
  | { kind: "custom"; matches: boolean };

/** Resolve the cluster the active `connection` is really on and compare with the configured one. */
export function useRpcCluster(): RpcClusterStatus {
  const { connection, cluster } = useHub();
  const q = useQuery({
    queryKey: ["hub", "genesis", connection.rpcEndpoint],
    queryFn: () => connection.getGenesisHash(),
    staleTime: Infinity,
    retry: 1,
  });

  if (q.isPending) return { kind: "checking" };
  if (q.isError) return { kind: "error" };
  const detected = GENESIS[q.data];
  if (!detected) return { kind: "custom", matches: cluster === "localnet" };
  return { kind: "known", cluster: detected, matches: detected === cluster };
}
