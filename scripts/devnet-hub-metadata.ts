// Attach Metaplex Token Metadata (name / symbol / logo URI) to the devnet $HUB mint so wallets
// and explorers render the token instead of "Unknown".
//   npx ts-node -T scripts/devnet-hub-metadata.ts [--uri URL] [--name "HUB Protocol"] [--symbol HUB]
// Idempotent: creates the metadata account if missing, otherwise updates it. The payer must be
// the mint authority (create) and the metadata update authority (update). The URI must serve
// the JSON in assets/hub-token.json (image → PNG), permanently pinned on Arweave/IPFS — see
// assets/security.json for the matching PMP program-metadata "security" seed content (logo only,
// written via `npx @solana-program/program-metadata write security <program> assets/security.json`).
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, devnetCtx, explorer, sendIxs, type Ctx } from "./lib/devnet";

export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MINT_SIZE = 82;
const DEFAULT_URI = "https://gateway.irys.xyz/B1fk41U4tmaBcLN1puY9iVqnka5Gfevq7cz9EYbRJqoV";
// Metaplex string limits (bytes, before the u32 length prefix).
const LIMITS = { name: 32, symbol: 10, uri: 200 };

export const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0];

const borshStr = (s: string) => {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** DataV2 { name, symbol, uri, seller_fee_basis_points: 0, creators/collection/uses: None }. */
function dataV2(name: string, symbol: string, uri: string) {
  for (const [k, v] of Object.entries({ name, symbol, uri })) {
    const max = LIMITS[k as keyof typeof LIMITS];
    if (Buffer.byteLength(v) > max) throw new Error(`${k} exceeds ${max} bytes`);
  }
  return Buffer.concat([
    borshStr(name),
    borshStr(symbol),
    borshStr(uri),
    Buffer.from([0, 0]), // seller_fee_basis_points u16
    Buffer.from([0, 0, 0]), // creators, collection, uses = None
  ]);
}

/** mpl-token-metadata `CreateMetadataAccountV3` (ix 33), is_mutable = true, no collection details. */
export function createMetadataV3(
  mint: PublicKey,
  authority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
) {
  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
      { pubkey: authority, isSigner: true, isWritable: true }, // payer
      { pubkey: authority, isSigner: true, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([33]), dataV2(name, symbol, uri), Buffer.from([1, 0])]),
  });
}

/** mpl-token-metadata `UpdateMetadataAccountV2` (ix 15): data = Some(DataV2), rest unchanged. */
export function updateMetadataV2(
  mint: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
) {
  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
      { pubkey: updateAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([15, 1]),
      dataV2(name, symbol, uri),
      Buffer.from([0, 0, 0]), // update_authority, primary_sale_happened, is_mutable = None
    ]),
  });
}

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const ctx: Ctx = await devnetCtx();
  const name = arg("--name", "HUB Protocol");
  const symbol = arg("--symbol", "HUB");
  const uri = arg("--uri", DEFAULT_URI);

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const mint: PublicKey = cfg.hubMint;
  const info = await ctx.connection.getAccountInfo(mint);
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== MINT_SIZE) {
    throw new Error(`Config.hub_mint ${mint.toBase58()} is not a Token-program mint`);
  }
  const mintAuthority = new PublicKey(info.data.subarray(4, 36));
  if (!mintAuthority.equals(ctx.payer.publicKey)) {
    throw new Error(`payer is not the mint authority (${mintAuthority.toBase58()})`);
  }

  const pda = metadataPda(mint);
  const exists = !!(await ctx.connection.getAccountInfo(pda));
  const ix = exists
    ? updateMetadataV2(mint, ctx.payer.publicKey, name, symbol, uri)
    : createMetadataV3(mint, ctx.payer.publicKey, name, symbol, uri);
  const sig = await sendIxs(ctx, [ix]);

  console.log(
    `${exists ? "updated" : "created"} metadata ${pda.toBase58()} for $HUB ${mint.toBase58()}`,
  );
  console.log(`  name=${name} symbol=${symbol}\n  uri=${uri}\n  ${explorer(sig, "tx")}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
