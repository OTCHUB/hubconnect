import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  fetchAirdropClaim,
  fetchOwnedDesks,
  type AirdropClaimView,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fetchDeskArtBatch, type DeskAssetArt } from "../lib/das";

export type AirdropDeskResult = {
  asset: string;
  /** NFT artwork/name via DAS; null when unavailable. */
  art: DeskAssetArt | null;
  /** Present ⇒ this desk has been paid (either `claim_airdrop` or `distribute_airdrop`). */
  claim: AirdropClaimView | null;
};

/**
 * §A7.1 airdrop checker — resolves every desk `address` currently owns and looks up each one's
 * `AirdropClaim` PDA. A push distribution stamps `claimant` with the desk's owner at payout time
 * (see `distribute_airdrop`), so "claim exists" is the definitive paid/unpaid signal regardless
 * of which path (authority push or self-claim) settled it.
 */
export function useAirdropCheck(address: string | null, state: ProtocolState | null) {
  const { connection, program, programId } = useHub();
  const owner = (() => {
    try {
      return address ? new PublicKey(address) : null;
    } catch {
      return null;
    }
  })();

  return useQuery({
    queryKey: [
      "hub",
      "airdrop-check",
      programId.toBase58(),
      connection.rpcEndpoint,
      owner?.toBase58(),
    ],
    enabled: owner !== null && state !== null,
    queryFn: async (): Promise<AirdropDeskResult[]> => {
      const collection = new PublicKey(state!.config.deskCollection);
      const assets = await fetchOwnedDesks(connection, owner!, collection);
      const assetKeys = assets.map((a) => a.toBase58());
      const [claims, artByAsset] = await Promise.all([
        Promise.all(assets.map((a) => fetchAirdropClaim(program, a))),
        fetchDeskArtBatch(connection.rpcEndpoint, assetKeys),
      ]);
      return assetKeys.map((asset, i) => ({
        asset,
        art: artByAsset[asset] ?? null,
        claim: claims[i],
      }));
    },
  });
}
