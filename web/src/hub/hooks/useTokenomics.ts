import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  burnPda,
  dexscreenerTokenInfo,
  fetchCollectionCounts,
  fetchTokenomics,
  tokenomicsPlan,
  type CollectionCounts,
  type DexscreenerTokenInfo,
  type ProtocolState,
  type TokenomicsPlan,
  type TokenomicsView,
} from "@hub-sdk";
import { useHub } from "../HubProvider";

export type Tokenomics = {
  /** On-chain `TokenomicsConfig`; null until the authority runs `init_tokenomics`. */
  onChain: TokenomicsView | null;
  /** Live Core collection counters (null if the collection account is unreadable). */
  collection: CollectionCounts | null;
  /** Desks the plan is computed from: snapshot count when published, else live `currentSize`. */
  deskCount: number;
  deskCountSource: "snapshot" | "live" | "none";
  plan: TokenomicsPlan;
  dexscreener: DexscreenerTokenInfo;
};

/**
 * §A7.1 — allocation plan for the Tokenomics tab. Reads the on-chain plan when it exists and
 * always recomputes the split with the SDK mirror so the chart works pre-`init_tokenomics`
 * (preview from the live desk count) and flags any divergence afterwards.
 */
export function useTokenomics(state: ProtocolState | null) {
  const { connection, program, programId } = useHub();
  return useQuery({
    queryKey: [
      "hub",
      "tokenomics",
      programId.toBase58(),
      connection.rpcEndpoint,
      state?.config.deskCollection,
      state?.supply.mintSupplyUnits?.toString(),
    ],
    enabled: state !== null,
    queryFn: async (): Promise<Tokenomics> => {
      const { config } = state!;
      const [onChain, collection] = await Promise.all([
        fetchTokenomics(program),
        fetchCollectionCounts(connection, new PublicKey(config.deskCollection)),
      ]);
      const snapshot = onChain && onChain.snapshotDeskCount > 0;
      const deskCount = snapshot ? onChain!.snapshotDeskCount : (collection?.currentSize ?? 0);
      const plan = tokenomicsPlan(deskCount, {
        maxUnits: onChain?.maxSupplyUnits,
        airdropPerDeskUnits: onChain?.airdropPerDeskUnits,
        treasuryLockBp: onChain?.treasuryLockBp,
        teamBp: onChain?.teamBp,
      });
      return {
        onChain,
        collection,
        deskCount,
        deskCountSource: snapshot ? "snapshot" : collection ? "live" : "none",
        plan,
        dexscreener: dexscreenerTokenInfo({
          state: state!,
          tokenomics: onChain,
          plan,
          burnPda: burnPda(programId)[0].toBase58(),
        }),
      };
    },
  });
}
