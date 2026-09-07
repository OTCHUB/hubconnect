// Create the devnet $HUB SPL mint and point Config.hub_mint at it (§B5.1 stub mint).
//   npx ts-node -T scripts/devnet-hub-mint.ts [--force] [--supply 1000000000] [--decimals 6]
// Idempotent: if Config.hub_mint already is a Token-program mint, only re-mints nothing and
// exits (use --force to create a fresh mint). Also re-points Config.ops_wallet at the payer so
// the 10% ops slice of test step fees recycles into the deployer instead of a lost harness key.
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { devnetCtx, explorer, setConfigPubkey, type Ctx } from "./lib/devnet";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT_SIZE = 82;

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];

/** spl-token `InitializeMint2` (ix 20): decimals · mint authority · no freeze authority. */
function initializeMint2(mint: PublicKey, decimals: number, authority: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([20, decimals]), authority.toBuffer(), Buffer.from([0])]),
  });
}

/** associated-token `CreateIdempotent` (ix 1). */
function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** spl-token `MintTo` (ix 7). */
function mintTo(mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint) {
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

async function isTokenMint(ctx: Ctx, key: PublicKey) {
  const info = await ctx.connection.getAccountInfo(key);
  return !!info && info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length === MINT_SIZE;
}

export async function createHubMint(ctx: Ctx, decimals: number, supply: bigint) {
  const mint = Keypair.generate();
  const owner = ctx.payer.publicKey;
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: owner,
      newAccountPubkey: mint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeMint2(mint.publicKey, decimals, owner),
    createAtaIdempotent(owner, owner, mint.publicKey),
    mintTo(mint.publicKey, ata(owner, mint.publicKey), owner, supply * 10n ** BigInt(decimals)),
  );
  const sig = await ctx.provider.sendAndConfirm(tx, [ctx.payer, mint]);
  return { mint: mint.publicKey, sig };
}

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const ctx = await devnetCtx();
  const decimals = Number(arg("--decimals", "6"));
  const supply = BigInt(arg("--supply", "1000000000"));
  const force = process.argv.includes("--force");

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (!force && (await isTokenMint(ctx, cfg.hubMint))) {
    console.log(
      `Config.hub_mint already a token mint: ${cfg.hubMint.toBase58()} (use --force to replace)`,
    );
  } else {
    const { mint, sig } = await createHubMint(ctx, decimals, supply);
    console.log(`$HUB devnet mint ${mint.toBase58()} · ${supply} × 10^${decimals} minted to payer`);
    console.log(`  ${explorer(sig, "tx")}`);
    await setConfigPubkey(ctx, "hubMint", mint);
  }
  await setConfigPubkey(ctx, "opsWallet", ctx.payer.publicKey);

  const after = await ctx.program.account.config.fetch(ctx.config);
  console.log(
    `config.hub_mint  = ${after.hubMint.toBase58()}  ${explorer(after.hubMint.toBase58())}`,
  );
  console.log(`config.ops_wallet = ${after.opsWallet.toBase58()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
