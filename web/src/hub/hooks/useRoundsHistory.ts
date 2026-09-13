import { useQuery } from "@tanstack/react-query";
import { fetchEpoch, type EpochView } from "@hub-sdk";
import { useHub } from "../HubProvider";

/** How many closed rounds to pull per page when the list is expanded further back. Kept small
 *  since the list is collapsed by default (see `RoundsList`) — a first expand shouldn't fan out
 *  into a big burst of `fetchEpoch` calls before the user has even asked to page further back. */
export const ROUNDS_PAGE_SIZE = 5;

/**
 * Closed rounds `[currentEpochIndex - count, currentEpochIndex - 1]`, newest first — bounded so
 * the dashboard never walks the full round history in one request. `null` entries (a round that
 * somehow never finalized/closed as an account) are dropped. `enabled` additionally gates the
 * fetch so a collapsed `RoundsList` costs zero RPC calls until the user actually expands it.
 */
export function useRoundsHistory(currentEpochIndex: number, count: number, enabled = true) {
  const { program, programId, connection } = useHub();
  const from = Math.max(0, currentEpochIndex - count);
  const to = currentEpochIndex - 1;

  return useQuery({
    queryKey: [
      "hub",
      "rounds",
      programId.toBase58(),
      connection.rpcEndpoint,
      currentEpochIndex,
      count,
    ],
    enabled: enabled && currentEpochIndex > 0,
    queryFn: async (): Promise<EpochView[]> => {
      if (to < from) return [];
      const indices: number[] = [];
      for (let i = to; i >= from; i--) indices.push(i);
      const epochs = await Promise.all(indices.map((i) => fetchEpoch(program, i)));
      return epochs.filter((e): e is EpochView => e !== null);
    },
  });
}
