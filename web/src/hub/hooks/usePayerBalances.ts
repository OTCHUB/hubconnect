import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ataPda } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type PayerBalances = {
  solLamports: bigint;
  /** Base units in the standard $OTC ATA; null when the account does not exist. */
  otcUnits: bigint | null;
  otcDecimals: number | null;
};

/** Raw SOL + $OTC (standard ATA) balances for the activate/upgrade panel — bigint, never floats. */
export function usePayerBalances(address: string | null, otcMint: string | null) {
  const { connection } = useHub();
  return useQuery({
    queryKey: ["hub", "payer-balances", connection.rpcEndpoint, address, otcMint],
    enabled: !!address && !!otcMint,
    refetchInterval: 20_000,
    queryFn: async (): Promise<PayerBalances> => {
      const owner = new PublicKey(address!);
      const [ata] = ataPda(owner, new PublicKey(otcMint!));
      const [sol, tok] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getTokenAccountBalance(ata, "confirmed").catch(() => null),
      ]);
      return {
        solLamports: BigInt(sol),
        otcUnits: tok ? BigInt(tok.value.amount) : null,
        otcDecimals: tok?.value.decimals ?? null,
      };
    },
  });
}
