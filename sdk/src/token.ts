// $HUB SPL mint / token-account / Metaplex metadata readers. Raw layout parsing (no
// @solana/spl-token, no mpl-token-metadata) so the SDK stays web3.js-only; the layouts are
// stable and the same ones scripts/hub-authority.ts already relies on.
import { Connection, PublicKey, TransactionInstruction, type AccountInfo } from "@solana/web3.js";
import { ataPda, tokenMetadataPda } from "./pda";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants";

export type MintView = {
  address: string;
  supplyUnits: bigint;
  decimals: number;
  /** `null` = revoked → supply immutable. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
};

export type TokenMetadataView = {
  /** Metadata PDA address. */
  address: string;
  updateAuthority: string;
  name: string;
  symbol: string;
  uri: string;
  isMutable: boolean;
};

/** Off-chain JSON pointed to by `TokenMetadataView.uri` (what indexers render). */
export type TokenOffchainMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  extensions?: Record<string, string>;
};

const cOption = (data: Buffer, off: number) =>
  data.readUInt32LE(off) === 1 ? new PublicKey(data.subarray(off + 4, off + 36)).toBase58() : null;

/** spl-token Mint (82 B): COption<Pubkey> mint_auth · u64 supply · u8 decimals · bool init · COption<Pubkey> freeze. */
export function parseMint(address: PublicKey, data: Buffer): MintView {
  if (data.length < 82)
    throw new Error(`mint ${address.toBase58()}: ${data.length} B, expected ≥82`);
  return {
    address: address.toBase58(),
    mintAuthority: cOption(data, 0),
    supplyUnits: data.readBigUInt64LE(36),
    decimals: data[44],
    freezeAuthority: cOption(data, 46),
  };
}

/** spl-token Account (165 B): mint · owner · u64 amount … — returns `amount`. */
export function parseTokenAmount(data: Buffer): bigint {
  return data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
}

const borshString = (data: Buffer, off: number): [string, number] => {
  const len = data.readUInt32LE(off);
  const raw = data.subarray(off + 4, off + 4 + len).toString("utf8");
  // Metaplex pads name/symbol/uri with NULs to a fixed width.
  return [raw.replace(/\0+$/, ""), off + 4 + len];
};

/** Metaplex `Metadata` v1 prefix: key u8 · update_authority · mint · Data{name,symbol,uri,sfbp u16,creators Option} · primary_sale bool · is_mutable bool. */
export function parseTokenMetadata(address: PublicKey, data: Buffer): TokenMetadataView {
  const updateAuthority = new PublicKey(data.subarray(1, 33)).toBase58();
  let off = 65;
  let name: string, symbol: string, uri: string;
  [name, off] = borshString(data, off);
  [symbol, off] = borshString(data, off);
  [uri, off] = borshString(data, off);
  off += 2; // seller_fee_basis_points
  if (data[off] === 1)
    off += 1 + 4 + data.readUInt32LE(off + 1) * 34; // Option<Vec<Creator>>
  else off += 1;
  off += 1; // primary_sale_happened
  const isMutable = data[off] === 1;
  return { address: address.toBase58(), updateAuthority, name, symbol, uri, isMutable };
}

export type HubTokenState = {
  mint: MintView | null;
  metadata: TokenMetadataView | null;
  /** Sum of $HUB held by the treasury multisig + program vault ATAs. */
  lockedUnits: bigint;
  holdings: { owner: string; ata: string; units: bigint }[];
};

/**
 * One RPC round trip: mint + metadata PDA + treasury-controlled ATAs. Tolerates missing
 * accounts (uninitialized devnet, unlaunched mainnet) by returning nulls / 0n.
 */
export async function fetchHubTokenState(
  connection: Connection,
  hubMint: PublicKey,
  lockedOwners: PublicKey[],
): Promise<HubTokenState> {
  const [metaKey] = tokenMetadataPda(hubMint);
  const atas = lockedOwners.map((o) => ({ owner: o, ata: ataPda(o, hubMint)[0] }));
  const infos: (AccountInfo<Buffer> | null)[] = await connection.getMultipleAccountsInfo([
    hubMint,
    metaKey,
    ...atas.map((a) => a.ata),
  ]);
  const [mintInfo, metaInfo, ...ataInfos] = infos;
  const holdings = atas.map(({ owner, ata }, i) => ({
    owner: owner.toBase58(),
    ata: ata.toBase58(),
    units: ataInfos[i] ? parseTokenAmount(ataInfos[i]!.data) : 0n,
  }));
  return {
    mint: mintInfo ? parseMint(hubMint, mintInfo.data) : null,
    metadata: metaInfo ? parseTokenMetadata(metaKey, metaInfo.data) : null,
    lockedUnits: holdings.reduce((s, h) => s + h.units, 0n),
    holdings,
  };
}

/**
 * Raw `AssociatedTokenAccountInstruction::CreateIdempotent` (discriminant `1`, no args) — the
 * $OTC leg's `claim_yield` pays into the claimer's standard ATA but never creates it (on-chain
 * `require_token_account` only checks mint/owner), so the frontend must ensure it exists. Safe
 * to always prepend: a no-op when the ATA is already there, one-time init otherwise. Kept here
 * (not `@solana/spl-token`) so the SDK stays a single dependency-light package.
 */
export function createAtaIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  const [ata] = ataPda(owner, mint);
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Fetch the off-chain JSON behind `uri` (IPFS/Arweave gateways return plain JSON). */
export async function fetchOffchainMetadata(uri: string): Promise<TokenOffchainMetadata | null> {
  if (!/^https?:\/\//.test(uri)) return null;
  try {
    const res = await fetch(uri, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as TokenOffchainMetadata;
  } catch {
    return null;
  }
}
