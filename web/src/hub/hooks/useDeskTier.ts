import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { fetchConsignment, fetchDeskTier, fetchEpoch, type EpochView } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { unclaimedEstimate } from "../lib/yield";

export const parsePubkey = (s: string): PublicKey | null => {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
};

// Cap how many historical Epoch accounts we read for the unclaimed estimate.
const MAX_UNCLAIMED_EPOCHS = 30;

export function useDeskTier(asset: string, currentEpoch: number | null) {
  const { program, programId, connection } = useHub();
  const key = parsePubkey(asset);

  return useQuery({
    queryKey: ["hub", "desk", programId.toBase58(), connection.rpcEndpoint, key?.toBase58()],
    enabled: key !== null && currentEpoch !== null,
    queryFn: async () => {
      const [tier, consignment] = await Promise.all([
        fetchDeskTier(program, key!),
        fetchConsignment(program, key!),
      ]);
      if (!tier || currentEpoch === null) return { tier, consignment, unclaimed: null };

      // Finalized epochs the desk has not yet claimed: [nextClaimEpoch, currentEpoch).
      const from = tier.nextClaimEpoch;
      const to = Math.min(currentEpoch - 1, from + MAX_UNCLAIMED_EPOCHS - 1);
      const idx = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
      const epochs = (await Promise.all(idx.map((i) => fetchEpoch(program, i)))).filter(
        (e): e is EpochView => e !== null,
      );
      const unclaimed = {
        fromEpoch: from,
        toEpoch: to,
        count: idx.length,
        truncated: currentEpoch - 1 > to,
        lamports: unclaimedEstimate(tier.tier, epochs),
      };
      return { tier, consignment, unclaimed };
    },
  });
}

export type DeskLookupResult = NonNullable<ReturnType<typeof useDeskTier>["data"]>;
