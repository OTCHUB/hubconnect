import { useQuery } from "@tanstack/react-query";
import type { ConfigView } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fetchDeskAssetByNumber, type DeskByNumber } from "../lib/das";

/**
 * Resolves a human "OTC Desk #<n>" number to its asset + current owner via DAS
 * (`getAssetsByGroup` on `Config.desk_collection`). Only works against DAS-capable RPCs
 * (Helius, Triton, etc.) — returns `null` on plain JSON-RPC endpoints or when no desk in the
 * collection carries that number.
 */
export function useDeskByNumber(deskNumber: number | null, config: ConfigView | null) {
  const { connection } = useHub();
  return useQuery<DeskByNumber | null>({
    queryKey: ["hub", "desk-by-number", connection.rpcEndpoint, config?.deskCollection, deskNumber],
    enabled: deskNumber !== null && deskNumber > 0 && config !== null,
    queryFn: () =>
      fetchDeskAssetByNumber(connection.rpcEndpoint, config!.deskCollection, deskNumber!),
  });
}
