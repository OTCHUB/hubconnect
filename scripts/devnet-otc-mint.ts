// Create the devnet $OTC SPL mint, point Config.otc_mint at it, and provision the §A5 90% leg
// (`init_otc_pot`) so `claim_yield` can start paying desks in $OTC.
//   npx ts-node -T scripts/devnet-otc-mint.ts [--force] [--supply 1000000000] [--decimals 6]
// Idempotent: if Config.otc_mint already is a Token-program mint, only re-mints nothing; if
// OtcPotState already exists, init_otc_pot is skipped. Use --force to create a fresh mint (does
// NOT re-run init_otc_pot — that account has no update path once created, matching the
// no-migration pattern documented on OtcPotState).
import { PublicKey, Transaction } from "@solana/web3.js";
import { otcPotPda, potPda } from "../sdk/src";
import {
  TOKEN_PROGRAM_ID,
  ata,
  createAtaIdempotent,
  devnetCtx,
  explorer,
  setConfigPubkey,
  type Ctx,
} from "./lib/devnet";
import { createHubMint } from "./devnet-hub-mint";

const MINT_SIZE = 82;

async function isTokenMint(ctx: Ctx, key: PublicKey) {
  const info = await ctx.connection.getAccountInfo(key);
  return !!info && info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length === MINT_SIZE;
}

/** spl-token associated-token-account `Create` (non-idempotent variant, ix omitted — reuse
 * `createAtaIdempotent`, which is safe even though the vault won't exist yet). */
async function ensureOtcVault(ctx: Ctx, otcMint: PublicKey) {
  const [pot] = potPda(ctx.program.programId);
  const vault = ata(pot, otcMint);
  const info = await ctx.connection.getAccountInfo(vault);
  if (info) return { vault, created: false };
  const ix = createAtaIdempotent(ctx.payer.publicKey, pot, otcMint);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  $OTC vault (ATA of pot PDA) created ${vault.toBase58()} (${sig})`);
  return { vault, created: true };
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

  const cfg0 = await ctx.program.account.config.fetch(ctx.config);
  let otcMint = cfg0.otcMint;
  if (!force && (await isTokenMint(ctx, otcMint))) {
    console.log(
      `Config.otc_mint already a token mint: ${otcMint.toBase58()} (use --force to replace)`,
    );
  } else {
    const { mint, sig } = await createHubMint(ctx, decimals, supply);
    otcMint = mint;
    console.log(`$OTC devnet mint ${mint.toBase58()} · ${supply} × 10^${decimals} minted to payer`);
    console.log(`  ${explorer(sig, "tx")}`);
    await setConfigPubkey(ctx, "otcMint", mint);
  }

  const [otcPotKey] = otcPotPda(ctx.program.programId);
  const existing = await ctx.program.account.otcPotState.fetchNullable(otcPotKey);
  if (existing) {
    console.log(`OtcPotState already initialized · vault ${existing.otcVault.toBase58()}`);
  } else {
    const { vault } = await ensureOtcVault(ctx, otcMint);
    const sig = await ctx.program.methods
      .initOtcPot(ctx.payer.publicKey)
      .accountsPartial({
        authority: ctx.payer.publicKey,
        config: ctx.config,
        otcVault: vault,
        otcPot: otcPotKey,
      })
      .rpc();
    console.log(
      `init_otc_pot :: keeper ${ctx.payer.publicKey.toBase58()} · vault ${vault.toBase58()}`,
    );
    console.log(`  ${explorer(sig, "tx")}`);
  }

  const after = await ctx.program.account.config.fetch(ctx.config);
  const pot = await ctx.program.account.otcPotState.fetch(otcPotKey);
  console.log(
    `config.otc_mint = ${after.otcMint.toBase58()}  ${explorer(after.otcMint.toBase58())}`,
  );
  console.log(
    `otc_pot.otc_vault = ${pot.otcVault.toBase58()}  ${explorer(pot.otcVault.toBase58())}`,
  );
  console.log(`otc_pot.authority (keeper) = ${pot.authority.toBase58()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
