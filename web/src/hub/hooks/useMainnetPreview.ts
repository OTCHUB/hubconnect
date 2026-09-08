import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchOwnedDesks } from "@hub-sdk";
import { fetchDeskArtBatch, type DeskAssetArt } from "../lib/das";
import { OTC_DESKS_COLLECTION_MAINNET } from "../lib/deployments";

/** Public, keyless mainnet-beta RPC — enough for `getProgramAccounts` (desk ownership) without a
 *  DAS-capable key; a Helius/Triton-style URL entered in the panel unlocks art/name lookups too. */
export const DEFAULT_MAINNET_PREVIEW_RPC = "https://api.mainnet-beta.solana.com";

export type MainnetPreviewDesk = { asset: string; art: DeskAssetArt | null };

/**
 * Read-only, cross-cluster preview: real mainnet-beta OTC Desks collection ownership + art for a
 * pasted mainnet wallet address. Deliberately independent of `useWalletPortfolio`/`HubProvider` —
 * it never touches the connected cluster's RPC, config, or the actual connected wallet, so it
 * can never be mistaken for (or silently mixed into) that wallet's real devnet/mainnet holdings.
 * No tier/yield data is shown — the $HUB program has no mainnet deployment yet, so there is
 * nothing on-chain to read for that; this is metadata/ownership rendering QA only.
 */
export function useMainnetPreview(rpcUrl: string, address: string | null) {
  const owner = (() => {
    try {
      return address ? new PublicKey(address) : null;
    } catch {
      return null;
    }
  })();

  return useQuery({
    queryKey: ["hub", "mainnet-preview", rpcUrl, owner?.toBase58()],
    enabled: owner !== null,
    queryFn: async (): Promise<MainnetPreviewDesk[]> => {
      const connection = new Connection(rpcUrl, "confirmed");
      const collection = new PublicKey(OTC_DESKS_COLLECTION_MAINNET);
      const assets = await fetchOwnedDesks(connection, owner!, collection);
      const assetKeys = assets.map((a) => a.toBase58());
      const artByAsset = await fetchDeskArtBatch(rpcUrl, assetKeys);
      return assetKeys.map((asset) => ({ asset, art: artByAsset[asset] ?? null }));
    },
  });
}
