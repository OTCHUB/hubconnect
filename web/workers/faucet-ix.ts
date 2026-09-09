// Raw instruction builders shared by the faucet Worker — hand-rolled (no @solana/spl-token, no
// mpl-core/umi) so the Worker bundle stays dependency-free. `mintToIx` mirrors the spl-token
// `MintTo` builder in scripts/devnet-hub-mint.ts; `coreCreateV1Ix` mirrors Metaplex Core's
// generated `createV1` (see node_modules/@metaplex-foundation/mpl-core/.../createV1.js) with
// `plugins` fixed to `Option::None` — the faucet's mock desks don't need on-chain Attributes,
// only membership in `collection` (so `require_desk`/`activate_tier` accept them) and an owner.
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

/** spl-token `MintTo` (ix 7): mint · destination ATA · authority (signer) · amount. */
export function mintToIx(mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint) {
  const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), u64le(amount)]),
  });
}

const borshString = (s: string) => {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
};

/**
 * Metaplex Core `CreateV1` (discriminator 0): dataState=AccountState(0) · name · uri ·
 * plugins=None. Accounts (fixed order — optional ones filled with `programId` per Core's own
 * `getAccountMetasAndSigners(..., 'programId', ...)` convention): asset, collection, authority,
 * payer, owner, updateAuthority(unused when collection is set), systemProgram, logWrapper(unused).
 * `authority` must already be an accepted signer for `collection` — either its update_authority
 * or an `additional_delegate` on its UpdateDelegate plugin (see devnet-faucet-authority.ts).
 */
export function coreCreateV1Ix(a: {
  programId: PublicKey;
  asset: PublicKey;
  collection: PublicKey;
  authority: PublicKey;
  payer: PublicKey;
  owner: PublicKey;
  name: string;
  uri: string;
}) {
  const data = Buffer.concat([
    Buffer.from([0]), // discriminator
    Buffer.from([0]), // DataState::AccountState
    borshString(a.name),
    borshString(a.uri),
    Buffer.from([0]), // plugins: Option::None
  ]);
  return new TransactionInstruction({
    programId: a.programId,
    keys: [
      { pubkey: a.asset, isSigner: true, isWritable: true },
      { pubkey: a.collection, isSigner: false, isWritable: true },
      { pubkey: a.authority, isSigner: true, isWritable: false },
      { pubkey: a.payer, isSigner: true, isWritable: true },
      { pubkey: a.owner, isSigner: false, isWritable: false },
      { pubkey: a.programId, isSigner: false, isWritable: false }, // updateAuthority (unused)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: a.programId, isSigner: false, isWritable: false }, // logWrapper (unused)
    ],
    data,
  });
}
