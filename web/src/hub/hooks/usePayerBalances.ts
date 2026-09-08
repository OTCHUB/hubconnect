import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ataPda } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type PayerBalances = {
  solLamports: bigint;
  /** Base units in the standard $OTC ATA; null when the account does not exist. */
  otcUnits: bigint | null;
  otcDecimals: number | null;
  /** Base units in the standard $HUB ATA; null when the account does not exist. Every
   * `activate_tier` / `upgrade_tier` call (SOL or $OTC path) burns from this account. */
  hubUnits: bigint | null;
  hubDecimals: number | null;
};

/** Raw SOL + $OTC + $HUB (standard ATAs) balances for the activate/upgrade panel — bigint, never
 * floats. `hubMint` is needed because every tier change burns $HUB regardless of pay method. */
export function usePayerBalances(
  address: string | null,
  otcMint: string | null,
  hubMint: string | null,
) {
  const { connection } = useHub();
  return useQuery({
    queryKey: ["hub", "payer-balances", connection.rpcEndpoint, address, otcMint, hubMint],
    enabled: !!address && !!otcMint && !!hubMint,
    refetchInterval: 20_000,
    queryFn: async (): Promise<PayerBalances> => {
      const owner = new PublicKey(address!);
      const [otcAta] = ataPda(owner, new PublicKey(otcMint!));
      const [hubAta] = ataPda(owner, new PublicKey(hubMint!));
      const [sol, otcTok, hubTok] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getTokenAccountBalance(otcAta, "confirmed").catch(() => null),
        connection.getTokenAccountBalance(hubAta, "confirmed").catch(() => null),
      ]);
      return {
        solLamports: BigInt(sol),
        otcUnits: otcTok ? BigInt(otcTok.value.amount) : null,
        otcDecimals: otcTok?.value.decimals ?? null,
        hubUnits: hubTok ? BigInt(hubTok.value.amount) : null,
        hubDecimals: hubTok?.value.decimals ?? null,
      };
    },
  });
}
