// One-time devnet provisioning for programs/mock_jupiter: creates the mock program's
// `mock_authority`-owned liquidity ATAs for $HUB / $OTC / WSOL / mock-USDC and funds them,
// simulating the "mainnet liquidity" a real Jupiter route would draw from — so `finalize_epoch`'s
// two-hop WSOL→USDC→$HUB swap / `activate_tier_otc` / `upgrade_tier_otc` can be exercised
// end-to-end on devnet (see scripts/lib/mock-jupiter.ts and hub's `mock-jupiter` Cargo feature).
// Idempotent: re-running only tops liquidity up, never recreates anything.
//
//   npx ts-node -T scripts/mock-jupiter-setup.ts [--hub-supply 500000000] [--otc-supply 500000000] [--usdc-supply 500000000] [--wsol-sol 50]
//
// Requires: Config.hub_mint / Config.otc_mint already created (devnet-hub-mint.ts /
// devnet-otc-mint.ts) with the devnet payer as mint authority — this script mints straight from
// that authority into the mock's reserve; it never touches real mainnet mints or Jupiter itself.
// There is no real USDC on devnet/localnet (see `sdk/src/constants.ts`'s `USDC_MINT` doc
// comment), so if `Config.usdc_mint` is unset this script also creates a fresh devnet-only mock
// USDC mint (payer as mint authority, 6 decimals) and points `Config.usdc_mint` at it — mirroring
// `devnet-hub-mint.ts`/`devnet-otc-mint.ts`'s own stub-mint pattern.
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  devnetCtx,
  explorer,
  sendIxs,
  setConfigPubkey,
  tokenAmount,
  TOKEN_PROGRAM_ID,
  type Ctx,
} from "./lib/devnet";
import { ensureMockLiquidityAtaIx, mockAuthorityPda, mockLiquidityAta } from "./lib/mock-jupiter";
import { WSOL_MINT } from "../sdk/src";
import { createHubMint } from "./devnet-hub-mint";

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

/** spl-token `MintTo` (ix 7), signed by the payer (assumed mint authority on devnet test mints). */
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

/** spl-token `SyncNative` (ix 17) — refreshes a WSOL ATA's token `amount` after a plain System
 * transfer tops up its lamports (the standard SOL-wrap sequence, mirroring
 * `jupiter_swap::sync_native` on the program side). */
function syncNative(account: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function fundSplLiquidity(ctx: Ctx, mint: PublicKey, targetUnits: bigint, label: string) {
  const vault = mockLiquidityAta(mint);
  const createIx = ensureMockLiquidityAtaIx(ctx.payer.publicKey, mint);
  const have = (await tokenAmount(ctx, vault)) ?? 0n;
  if (have >= targetUnits) {
    console.log(`${label} liquidity ${vault.toBase58()} already has ${have} units — skipping`);
    return;
  }
  const top = targetUnits - have;
  const sig = await sendIxs(ctx, [createIx, mintTo(mint, vault, ctx.payer.publicKey, top)]);
  console.log(`${label} liquidity ${vault.toBase58()} topped up +${top} → ${targetUnits} units`);
  console.log(`  ${explorer(sig, "tx")}`);
}

async function fundWsolLiquidity(ctx: Ctx, targetLamports: bigint) {
  const wsolMint = new PublicKey(WSOL_MINT);
  const vault = mockLiquidityAta(wsolMint);
  const createIx = ensureMockLiquidityAtaIx(ctx.payer.publicKey, wsolMint);
  const have = (await tokenAmount(ctx, vault)) ?? 0n;
  if (have >= targetLamports) {
    console.log(`WSOL liquidity ${vault.toBase58()} already has ${have} lamports — skipping`);
    return;
  }
  const top = targetLamports - have;
  const transferIx = SystemProgram.transfer({
    fromPubkey: ctx.payer.publicKey,
    toPubkey: vault,
    lamports: top,
  });
  const sig = await sendIxs(ctx, [createIx, transferIx, syncNative(vault)]);
  console.log(`WSOL liquidity ${vault.toBase58()} topped up +${top} lamports → ${targetLamports}`);
  console.log(`  ${explorer(sig, "tx")}`);
}

async function ensureMockUsdcMint(ctx: Ctx, supply: bigint): Promise<PublicKey> {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (!cfg.usdcMint.equals(PublicKey.default)) {
    return new PublicKey(cfg.usdcMint);
  }
  const { mint, sig } = await createHubMint(ctx, 6, supply);
  console.log(`mock USDC devnet mint ${mint.toBase58()} · ${supply} × 10^6 minted to payer`);
  console.log(`  ${explorer(sig, "tx")}`);
  await setConfigPubkey(ctx, "usdcMint", mint);
  return mint;
}

async function main() {
  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const hubMint = new PublicKey(cfg.hubMint);
  const otcMint = new PublicKey(cfg.otcMint);
  const hubSupply = BigInt(arg("--hub-supply", "500000000")) * 10n ** 6n;
  const otcSupply = BigInt(arg("--otc-supply", "500000000")) * 10n ** 6n;
  const usdcSupply = BigInt(arg("--usdc-supply", "500000000")) * 10n ** 6n;
  const wsolSol = BigInt(arg("--wsol-sol", "50")) * 1_000_000_000n;

  const usdcMint = await ensureMockUsdcMint(ctx, usdcSupply);

  console.log(`mock_authority PDA: ${mockAuthorityPda().toBase58()}`);
  await fundSplLiquidity(ctx, hubMint, hubSupply, "$HUB");
  await fundSplLiquidity(ctx, otcMint, otcSupply, "$OTC");
  await fundSplLiquidity(ctx, usdcMint, usdcSupply, "mock-USDC");
  await fundWsolLiquidity(ctx, wsolSol);
  console.log("mock Jupiter liquidity ready — see scripts/lib/mock-jupiter.ts for route building");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
