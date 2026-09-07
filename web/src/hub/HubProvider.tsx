import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createReader, programId as idlProgramId, type HubProgram } from "@hub-sdk";
import type { HubCluster } from "./lib/explorer";
import { DEFAULT_COLLECTION_URL } from "./lib/marketplace";
import { jupiterLiteTransport, type SwapTransport } from "./lib/swap";
import { getSignerForAddress, type WalletSigner } from "./lib/wallets";

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
  /**
   * Host-owned signer lookup (otchub's walletSigner). Defaults to the module's own wallet
   * registry, populated by its WALLET_CONNECT panel.
   */
  resolveSigner?: (address: string) => WalletSigner | null;
  /** Jupiter quote/build transport; defaults to the public lite API (browser-direct). */
  swapTransport?: SwapTransport;
  /** Magic Eden collection page for desks; item links are derived from the asset address. */
  marketplaceCollectionUrl?: string;
  children: ReactNode;
};

export type HubContextValue = {
  connection: Connection;
  program: HubProgram;
  programId: PublicKey;
  cluster: HubCluster;
  pollMs: number;
  resolveSigner: (address: string) => WalletSigner | null;
  swapTransport: SwapTransport;
  marketplaceCollectionUrl: string;
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
  resolveSigner,
  swapTransport,
  marketplaceCollectionUrl,
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
      resolveSigner: resolveSigner ?? getSignerForAddress,
      swapTransport: swapTransport ?? jupiterLiteTransport,
      marketplaceCollectionUrl: marketplaceCollectionUrl ?? DEFAULT_COLLECTION_URL,
    }),
    [conn, pid, cluster, pollMs, resolveSigner, swapTransport, marketplaceCollectionUrl],
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
