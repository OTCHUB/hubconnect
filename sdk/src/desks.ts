// Desk discovery: which Metaplex Core assets in `Config.desk_collection` a wallet owns.
// Shared by the dashboard portfolio (web/) and the devnet mock-desk script so both use the exact
// account filter the program enforces in `require_desk` (programs/hub/src/instructions/mpl_core.rs).
import { Connection, PublicKey } from "@solana/web3.js";
import { MPL_CORE_PROGRAM_ID } from "./constants";

// Core AssetV1 prefix: [0] key=1 · [1..33] owner · [33] UpdateAuthority tag (2 = Collection) · [34..66] collection
export const CORE_KEY_ASSET_V1 = 1;
export const CORE_UA_COLLECTION = 2;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Owner + collection `getProgramAccounts` filter (data-less; returns asset pubkeys only). */
export async function fetchOwnedDesks(
  connection: Connection,
  owner: PublicKey,
  collection: PublicKey,
): Promise<PublicKey[]> {
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
