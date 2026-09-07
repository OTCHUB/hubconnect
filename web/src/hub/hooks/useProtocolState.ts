import { useQuery } from "@tanstack/react-query";
import { fetchProtocolState, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type ProtocolStatus =
  | { kind: "loading" }
  | { kind: "uninitialized" }
  | { kind: "error"; message: string }
  | { kind: "ready"; state: ProtocolState; fetchedAt: number };

// Anchor throws this text when the Config PDA has no account yet (program not initialized).
const isMissingAccount = (e: unknown) =>
  e instanceof Error && /Account does not exist|could not find account/i.test(e.message);

export function useProtocolState() {
  const { program, programId, connection, pollMs } = useHub();

  const q = useQuery({
    queryKey: ["hub", "protocol", programId.toBase58(), connection.rpcEndpoint],
    queryFn: () => fetchProtocolState(program),
    refetchInterval: pollMs,
    retry: (count, err) => !isMissingAccount(err) && count < 1,
  });

  let status: ProtocolStatus;
  if (q.data) status = { kind: "ready", state: q.data, fetchedAt: q.dataUpdatedAt };
  else if (q.isPending) status = { kind: "loading" };
  else if (isMissingAccount(q.error)) status = { kind: "uninitialized" };
  else status = { kind: "error", message: (q.error as Error | null)?.message ?? "unknown" };

  return { status, refetch: q.refetch, isFetching: q.isFetching };
}
