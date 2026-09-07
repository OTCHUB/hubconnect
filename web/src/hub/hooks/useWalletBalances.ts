import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ataPda } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type RawBalances = {
  solLamports: bigint;
  /** Base units in the standard ATA only; 0n when the account does not exist. */
  hubUnits: bigint;
};

/** Raw SOL + $HUB (standard ATA) balances for the swap panel — bigint, never floats. */
export function useWalletBalances(address: string | null, hubMint: string | null) {
  const { connection } = useHub();
  return useQuery({
    queryKey: ["hub", "balances", connection.rpcEndpoint, address, hubMint],
    enabled: !!address && !!hubMint,
    refetchInterval: 20_000,
    queryFn: async (): Promise<RawBalances> => {
      const owner = new PublicKey(address!);
      const [ata] = ataPda(owner, new PublicKey(hubMint!));
      const [sol, tok] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getTokenAccountBalance(ata, "confirmed").catch(() => null),
      ]);
      return { solLamports: BigInt(sol), hubUnits: BigInt(tok?.value.amount ?? "0") };
    },
  });
}
