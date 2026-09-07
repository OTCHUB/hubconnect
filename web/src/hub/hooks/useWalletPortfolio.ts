import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { fetchDeskTier, fetchOwnedDesks, type DeskTierView, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type OwnedDesk = { asset: string; tier: DeskTierView | null };

export type WalletPortfolio = {
  solLamports: number;
  /** Raw $HUB units (mint decimals applied) — null when the wallet holds no token account. */
  hubBalance: number | null;
  desks: OwnedDesk[];
};

export function useWalletPortfolio(address: string | null, state: ProtocolState | null) {
  const { connection, program, programId } = useHub();
  const owner = (() => {
    try {
      return address ? new PublicKey(address) : null;
    } catch {
      return null;
    }
  })();

  return useQuery({
    queryKey: ["hub", "wallet", programId.toBase58(), connection.rpcEndpoint, owner?.toBase58()],
    enabled: owner !== null && state !== null,
    queryFn: async (): Promise<WalletPortfolio> => {
      const hubMint = new PublicKey(state!.config.hubMint);
      const collection = new PublicKey(state!.config.deskCollection);
      const [solLamports, tokenAccounts, assets] = await Promise.all([
        connection.getBalance(owner!),
        connection.getParsedTokenAccountsByOwner(owner!, { mint: hubMint }).catch(() => null),
        fetchOwnedDesks(connection, owner!, collection),
      ]);
      const hubBalance =
        tokenAccounts && tokenAccounts.value.length
          ? tokenAccounts.value.reduce(
              (s, t) => s + Number(t.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
              0,
            )
          : null;
      const tiers = await Promise.all(assets.map((a) => fetchDeskTier(program, a)));
      const desks = assets.map((a, i) => ({ asset: a.toBase58(), tier: tiers[i] }));
      return { solLamports, hubBalance, desks };
    },
  });
}
