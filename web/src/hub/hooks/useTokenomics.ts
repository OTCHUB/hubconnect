import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  AIRDROP_DESK_CAP,
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
  /**
   * Desks the plan is computed from: the published snapshot count once `init_tokenomics` has
   * run, else the fixed `AIRDROP_DESK_CAP` launch-policy target (README / §A3 / §A7.1) — never
   * today's live desk count. Pre-snapshot, the collection is usually a handful of devnet mock
   * desks; sizing the preview off that would show a near-empty airdrop slice and ~100% public,
   * which is not the split the protocol has actually committed to. The decided launch split
   * (yield 2% / LP 0.5% / airdrop ≤2.5% / public ≥95%) is fixed policy, not something that grows
   * in with on-chain activity, so the preview always previews it at the target cap.
   */
  deskCount: number;
  deskCountSource: "snapshot" | "target";
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
      // Fixed launch-policy target pre-snapshot — never today's live desk count (see the
      // `deskCount` doc comment above for why).
      const deskCount = snapshot ? onChain!.snapshotDeskCount : AIRDROP_DESK_CAP;
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
        deskCountSource: snapshot ? "snapshot" : "target",
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
