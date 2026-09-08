import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  fetchConsignment,
  fetchDeskTier,
  fetchEpoch,
  pendingYieldLamports,
  type ConfigView,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fetchDeskArt, type DeskAssetArt } from "../lib/das";

export const parsePubkey = (s: string): PublicKey | null => {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
};

// Cap how many closed Epoch accounts we walk back to count rounds since the desk's stamp.
const MAX_ROUND_SCAN = 30;

export function useDeskTier(asset: string, config: ConfigView | null) {
  const { program, programId, connection } = useHub();
  const key = parsePubkey(asset);

  return useQuery({
    queryKey: [
      "hub",
      "desk",
      programId.toBase58(),
      connection.rpcEndpoint,
      key?.toBase58(),
      config?.accPerWeight.toString(),
    ],
    enabled: key !== null && config !== null,
    queryFn: async () => {
      const [tier, consignment, art] = await Promise.all([
        fetchDeskTier(program, key!),
        fetchConsignment(program, key!),
        fetchDeskArt(connection.rpcEndpoint, key!.toBase58()),
      ]);
      if (!tier || config === null) return { tier, consignment, pending: null, art };

      // Exact, one-tx claimable amount: ⌊(acc − stamp) × w / 10¹²⌋ — no per-round scan needed.
      const lamports = pendingYieldLamports(tier, config);

      // Closed rounds whose credit landed after the stamp, newest first, bounded.
      let rounds = 0;
      let truncated = false;
      for (let i = config.currentEpoch - 1; i >= 0 && !tier.voided; i--) {
        if (rounds >= MAX_ROUND_SCAN) {
          truncated = true;
          break;
        }
        const e = await fetchEpoch(program, i);
        if (!e || !e.finalized || e.accPerWeightAfter <= tier.stampAccPerWeight) break;
        rounds++;
      }
      return { tier, consignment, pending: { lamports, rounds, truncated }, art };
    },
  });
}

export type DeskLookupResult = NonNullable<ReturnType<typeof useDeskTier>["data"]>;
export type { DeskAssetArt };
