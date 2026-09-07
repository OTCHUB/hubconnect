import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  MPL_CORE_PROGRAM_ID,
  fetchDeskTier,
  type DeskTierView,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";

export type OwnedDesk = { asset: string; tier: DeskTierView | null };

export type WalletPortfolio = {
  solLamports: number;
  /** Raw $HUB units (mint decimals applied) — null when the wallet holds no token account. */
  hubBalance: number | null;
  desks: OwnedDesk[];
};

// Core AssetV1 layout (programs/hub/src/instructions/mpl_core.rs):
//   [0] key=1 · [1..33] owner · [33] UpdateAuthority tag (2 = Collection) · [34..66] collection
const CORE_KEY_ASSET_V1 = 1;
const CORE_UA_COLLECTION = 2;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function fetchOwnedDesks(
  connection: ReturnType<typeof useHub>["connection"],
  owner: PublicKey,
  collection: PublicKey,
) {
  const accounts = await connection.getProgramAccounts(new PublicKey(MPL_CORE_PROGRAM_ID), {
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: b64(Uint8Array.of(CORE_KEY_ASSET_V1)), encoding: "base64" } },
      { memcmp: { offset: 1, bytes: owner.toBase58() } },
      {
        memcmp: {
          offset: 33,
          bytes: b64(Uint8Array.of(CORE_UA_COLLECTION, ...collection.toBytes())),
          encoding: "base64",
        },
      },
    ],
  });
  return accounts.map((a) => a.pubkey);
}

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
