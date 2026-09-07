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

/** Every Core asset in `collection`, any owner — the airdrop snapshot set (§A7.1). */
export async function fetchCollectionAssets(
  connection: Connection,
  collection: PublicKey,
): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(new PublicKey(MPL_CORE_PROGRAM_ID), {
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: b64(Uint8Array.of(CORE_KEY_ASSET_V1)), encoding: "base64" } },
      {
        memcmp: {
          offset: 33,
          bytes: b64(Uint8Array.of(CORE_UA_COLLECTION, ...collection.toBytes())),
          encoding: "base64",
        },
      },
    ],
  });
  return accounts.map((a) => a.pubkey).sort((a, b) => a.toBuffer().compare(b.toBuffer()));
}

// Core CollectionV1 prefix: [0] key=5 · [1..33] update_authority · name(String) · uri(String) · num_minted u32 · current_size u32
export const CORE_KEY_COLLECTION_V1 = 5;

export type CollectionCounts = {
  /** Lifetime mints into the collection (never decrements). */
  numMinted: number;
  /** Assets currently in the collection (burns decrement). */
  currentSize: number;
};

/** Reads the collection account's own counters — one `getAccountInfo`, no gPA scan. */
export function parseCollectionCounts(data: Buffer): CollectionCounts | null {
  if (data.length < 41 || data[0] !== CORE_KEY_COLLECTION_V1) return null;
  let off = 33;
  const nameLen = data.readUInt32LE(off);
  off += 4 + nameLen;
  const uriLen = data.readUInt32LE(off);
  off += 4 + uriLen;
  if (data.length < off + 8) return null;
  return { numMinted: data.readUInt32LE(off), currentSize: data.readUInt32LE(off + 4) };
}

export async function fetchCollectionCounts(
  connection: Connection,
  collection: PublicKey,
): Promise<CollectionCounts | null> {
  const info = await connection.getAccountInfo(collection);
  if (!info || !info.owner.equals(new PublicKey(MPL_CORE_PROGRAM_ID))) return null;
  return parseCollectionCounts(info.data);
}
