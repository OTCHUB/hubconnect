import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  fetchDeskTier,
  fetchOwnedDesks,
  pendingYieldLamports,
  type DeskTierView,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fetchDeskArtBatch, type DeskAssetArt } from "../lib/das";
import { yieldBoostPctOverBase } from "../lib/yield";

export type OwnedDesk = {
  asset: string;
  tier: DeskTierView | null;
  /** NFT artwork/name via DAS; null when the RPC has no DAS support or the lookup failed. */
  art: DeskAssetArt | null;
  /** ⌊(acc − stamp) × w / 10¹²⌋ right now — 0 for raw/voided desks. */
  pendingLamports: number;
  /** Whole-percent yield boost vs the base (T1) tier weight — 0 for raw/voided desks. */
  yieldBoostPct: number;
};

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
      const assetKeys = assets.map((a) => a.toBase58());
      const [tiers, artByAsset] = await Promise.all([
        Promise.all(assets.map((a) => fetchDeskTier(program, a))),
        fetchDeskArtBatch(connection.rpcEndpoint, assetKeys),
      ]);
      const desks: OwnedDesk[] = assetKeys.map((asset, i) => {
        const tier = tiers[i];
        const active = tier && !tier.voided;
        return {
          asset,
          tier,
          art: artByAsset[asset] ?? null,
          pendingLamports: active ? pendingYieldLamports(tier, state!.config) : 0,
          yieldBoostPct: active ? yieldBoostPctOverBase(tier.tier) : 0,
        };
      });
      return { solLamports, hubBalance, desks };
    },
  });
}
