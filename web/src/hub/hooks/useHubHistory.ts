import { useQuery } from "@tanstack/react-query";
import { fetchHubHistory, type HubHistoryPoint } from "../lib/supabaseHistory";
import { useHub } from "../HubProvider";

/**
 * Supabase-backed history feed for the dashboard's trend charts. Best-effort and additive: a
 * missed fetch (unconfigured/unreachable Supabase, or before the first ingest run) resolves to
 * `null` rather than an error — every consumer must keep rendering the live on-chain snapshot
 * with the chart simply omitted, exactly like `useTokenomics`/`useTreasuryPortfolio` behave when
 * their own on-chain accounts don't exist yet.
 */
export function useHubHistory() {
  const { cluster } = useHub();
  return useQuery({
    queryKey: ["hub", "history", cluster],
    queryFn: (): Promise<HubHistoryPoint[] | null> => fetchHubHistory(cluster),
    staleTime: 55_000,
    retry: false,
  });
}
