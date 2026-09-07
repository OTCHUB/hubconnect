import { useQuery } from "@tanstack/react-query";
import { fetchOtcPay, type OtcPayView } from "@hub-sdk";
import { useHub } from "../HubProvider";

/** §A4.1 `OtcPayConfig` — `data === null` means the $OTC path is not initialized on this cluster. */
export function useOtcPay() {
  const { program, programId, connection, pollMs } = useHub();
  return useQuery({
    queryKey: ["hub", "otc-pay", programId.toBase58(), connection.rpcEndpoint],
    queryFn: (): Promise<OtcPayView | null> => fetchOtcPay(program),
    refetchInterval: pollMs,
  });
}
