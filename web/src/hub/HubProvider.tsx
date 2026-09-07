import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createReader, programId as idlProgramId, type HubProgram } from "@hub-sdk";
import type { HubCluster } from "./lib/explorer";

export type HubProviderProps = {
  /** Used when `connection` is not supplied. */
  rpcUrl?: string;
  /** Reuse the host app's Connection (otchub) instead of opening a second one. */
  connection?: Connection;
  /** Defaults to the address baked into the IDL. */
  programId?: string | PublicKey;
  /** Explorer link target only — does not change which RPC is queried. */
  cluster?: HubCluster;
  /** Polling interval for on-chain reads. */
  pollMs?: number;
  /** Reuse the host app's QueryClient; a private one is created otherwise. */
  queryClient?: QueryClient;
  children: ReactNode;
};

export type HubContextValue = {
  connection: Connection;
  program: HubProgram;
  programId: PublicKey;
  cluster: HubCluster;
  pollMs: number;
};

const HubContext = createContext<HubContextValue | null>(null);

const DEFAULT_RPC = "https://api.devnet.solana.com";

export function HubProvider({
  rpcUrl,
  connection,
  programId,
  cluster = "devnet",
  pollMs = 15_000,
  queryClient,
  children,
}: HubProviderProps) {
  const ownClient = useRef<QueryClient | null>(null);
  if (!queryClient && !ownClient.current) {
    ownClient.current = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    });
  }
  const client = queryClient ?? ownClient.current!;

  const conn = useMemo(
    () => connection ?? new Connection(rpcUrl ?? DEFAULT_RPC, "confirmed"),
    [connection, rpcUrl],
  );

  const pid = useMemo(() => (programId ? new PublicKey(programId) : idlProgramId()), [programId]);

  const value = useMemo<HubContextValue>(
    () => ({
      connection: conn,
      program: createReader(conn, pid),
      programId: pid,
      cluster,
      pollMs,
    }),
    [conn, pid, cluster, pollMs],
  );

  return (
    <QueryClientProvider client={client}>
      <HubContext.Provider value={value}>{children}</HubContext.Provider>
    </QueryClientProvider>
  );
}

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error("useHub must be used inside <HubProvider>");
  return ctx;
}
