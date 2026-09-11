// One-time mainnet bootstrap for the §A5 90% leg — `init_otc_pot`. Missing on mainnet (unlike
// devnet's `devnet-otc-mint.ts`, which creates a throwaway $OTC mint + calls this in one step):
// mainnet's `Config.otc_mint` is already the real, live `OTC_MINT_MAINNET` (set by
// `mainnet-init-config.ts`), but nothing ever created `OtcPotState` — every `finalize_epoch` call
// fails with `AccountNotInitialized` on the `otc_pot` account until this runs.
//
//   npx ts-node -T scripts/mainnet-init-otc-pot.ts [--dry-run]
//
// 1. Ensures the `["pot"]`-PDA-owned Token-2022 ATA for `Config.otc_mint` ($OTC is a real
//    Token-2022 mint on mainnet, unlike devnet's plain-SPL stand-in) via `createAtaIdempotent2022`
//    /`ata2022` — matches `init_otc_pot`'s `otc_vault` constraint (owner = `config.pot`).
// 2. Calls `init_otc_pot(keeper)` once — no update path afterwards (same no-migration pattern as
//    `init_hub_pot`/`init_tokenomics`). Idempotent: exits early if `OtcPotState` already exists.
// `--keeper` sets `OtcPotState.authority` (the wallet trusted to call `record_otc_buy`); defaults
// to the payer (`HUB_MAINNET_WALLET`) if omitted.
import { PublicKey, Transaction } from "@solana/web3.js";
import { fetchOtcPot, otcPotPda, potPda } from "../sdk/src";
import {
  ata2022,
  createAtaIdempotent2022,
  explorer,
  mainnetCtx,
  OTC_MINT_MAINNET,
  parseFlags,
  type Ctx,
} from "./lib/mainnet";

/** Ensure `owner`'s Token-2022 ATA for `mint` exists; returns the address regardless. */
async function ensureVault2022(ctx: Ctx, owner: PublicKey, mint: PublicKey, label: string) {
  const vault = ata2022(owner, mint);
  if (await ctx.connection.getAccountInfo(vault)) return vault;
  const ix = createAtaIdempotent2022(ctx.payer.publicKey, owner, mint);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  $OTC vault (Token-2022 ATA of pot PDA) created ${vault.toBase58()} (${sig})`);
  return vault;
}

async function main() {
  const { get, has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();

  const existing = await fetchOtcPot(ctx.program);
  if (existing) {
    console.log("OtcPotState already initialized:");
    console.log(`  otc_vault = ${existing.otcVault}`);
    console.log(`  authority (keeper) = ${existing.authority}`);
    return;
  }

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const otcMint = cfg.otcMint;
  if (otcMint.equals(PublicKey.default) || !otcMint.equals(OTC_MINT_MAINNET)) {
    throw new Error(
      `Config.otc_mint (${otcMint.toBase58()}) is not the expected ${OTC_MINT_MAINNET.toBase58()} — run mainnet-init-config.ts first`,
    );
  }
  const keeper = new PublicKey(get("--keeper") ?? ctx.payer.publicKey);

  console.log(`about to init_otc_pot with otc_mint=${otcMint.toBase58()} keeper=${keeper.toBase58()}`);
  if (has("--dry-run")) {
    console.log("dry-run: not creating the vault or sending a transaction");
    return;
  }

  const [pot] = potPda(ctx.program.programId);
  const [otcPotKey] = otcPotPda(ctx.program.programId);
  const otcVault = await ensureVault2022(ctx, pot, otcMint, "OTC");

  const sig = await ctx.program.methods
    .initOtcPot(keeper)
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      otcVault,
      otcPot: otcPotKey,
    })
    .rpc();
  console.log(`init_otc_pot :: ${explorer(sig, "tx")}`);

  const after = await fetchOtcPot(ctx.program);
  console.log("OtcPotState:", JSON.stringify(after, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
