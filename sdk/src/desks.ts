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

/** Live owner of a single Core asset — `key(1) + owner(32)` is at the same offset regardless of
 * the asset's `UpdateAuthority` variant, so this works for any asset, desk or not. `null` when
 * the account doesn't exist (burned / never minted) or isn't a Core asset. */
export async function fetchCoreAssetOwner(
  connection: Connection,
  asset: PublicKey,
): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(asset, "confirmed");
  if (!info || !info.owner.equals(new PublicKey(MPL_CORE_PROGRAM_ID))) return null;
  if (info.data.length < 33 || info.data[0] !== CORE_KEY_ASSET_V1) return null;
  return new PublicKey(info.data.subarray(1, 33));
}

// AssetV1 prefix past the CORE_UA_COLLECTION-filtered assets `fetchOwnedDesks`/`fetchCollectionAssets`
// already select: [33] tag=2 (Collection) · [34..66] collection · name(String) starts at 66.
const CORE_ASSET_NAME_OFFSET = 66;

/** Best-effort on-chain `name` for a Collection-authority Core asset (no DAS dependency); `null`
 * when the slice is too short or the length prefix doesn't fit (e.g. `dataSlice` truncated it). */
function parseCollectionAssetName(data: Buffer): string | null {
  if (data.length < CORE_ASSET_NAME_OFFSET + 4) return null;
  const len = data.readUInt32LE(CORE_ASSET_NAME_OFFSET);
  const start = CORE_ASSET_NAME_OFFSET + 4;
  if (data.length < start + len) return null;
  return data.subarray(start, start + len).toString("utf8");
}

export type DeskOwnerEntry = {
  asset: PublicKey;
  owner: PublicKey;
  /** Parsed from a `"...#<n>"` on-chain `name` (the mint-script convention, e.g. "OTC Desk #42");
   * `null` when the name doesn't match, so callers can fall back to another ordering. */
  deskNumber: number | null;
};

/**
 * Every desk asset in `collection` with its *current* owner (+ desk number when the on-chain
 * `name` follows the `"...#<n>"` convention) — direct RPC scan, no DAS/indexer dependency. Used
 * by the mainnet genesis snapshot script (§A7.1) where indexer lag or availability must never
 * affect who is credited the airdrop. Sorted by asset pubkey for a deterministic, reproducible
 * snapshot regardless of RPC response ordering.
 */
export async function fetchDeskOwners(
  connection: Connection,
  collection: PublicKey,
): Promise<DeskOwnerEntry[]> {
  const accounts = await connection.getProgramAccounts(new PublicKey(MPL_CORE_PROGRAM_ID), {
    dataSlice: { offset: 0, length: 256 },
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
  return accounts
    .map(({ pubkey, account }) => {
      const data = account.data as Buffer;
      const name = parseCollectionAssetName(data);
      const match = name ? /#(\d+)/.exec(name) : null;
      return {
        asset: pubkey,
        owner: new PublicKey(data.subarray(1, 33)),
        deskNumber: match ? Number(match[1]) : null,
      };
    })
    .sort((a, b) => a.asset.toBuffer().compare(b.asset.toBuffer()));
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
