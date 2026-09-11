// One-time mainnet bootstrap for the §A5.1 HUB Pot "M.I.M ETF" basket — the real 4-leg basket
// ($OTC + Backed Finance xStock CRCLx/NVDAx/SPCXx, all live Token-2022 mints on mainnet-beta;
// devnet's `devnet-hub-pot-mint.ts` mints 3 throwaway test stand-ins instead). Every leg's
// TransferHook is confirmed Disabled on-chain (verified via `spl-token display --program-2022`
// before this script was written) — plain Token-2022 ATAs are sufficient, no extra-account
// wiring needed.
//
//   npx ts-node -T scripts/mainnet-init-hub-pot.ts [--dry-run]
//
// 1. Ensures the 4 vault-PDA-owned ATAs `init_hub_pot` requires (one per basket leg) —
//    Token-2022 ATAs via `createAtaIdempotent2022`/`ata2022` (correctly sized/extended by the
//    Associated Token Account program, unlike a hand-rolled fixed-165-byte account).
// 2. Calls `init_hub_pot` once (no update path afterwards — same no-migration pattern as
//    `init_tokenomics`/`init_treasury_float`). Idempotent: exits early if `HubPotConfig` already
//    exists.
// Needed before the Hub UI's M.I.M ETF component can read `HubPotConfig` — `useHubPot()` reads
// these mint addresses live off-chain.
import { PublicKey, Transaction } from "@solana/web3.js";
import { fetchHubPot, treasuryPda, vaultPda } from "../sdk/src";
import {
  ata2022,
  createAtaIdempotent2022,
  CRCLX_MINT_MAINNET,
  explorer,
  mainnetCtx,
  NVDAX_MINT_MAINNET,
  parseFlags,
  SPCXX_MINT_MAINNET,
  type Ctx,
} from "./lib/mainnet";

/** Ensure `owner`'s Token-2022 ATA for `mint` exists; returns the address regardless. */
async function ensureVault2022(ctx: Ctx, owner: PublicKey, mint: PublicKey, label: string) {
  const vault = ata2022(owner, mint);
  if (await ctx.connection.getAccountInfo(vault)) return vault;
  const ix = createAtaIdempotent2022(ctx.payer.publicKey, owner, mint);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  ${label} vault (Token-2022 ATA of vault PDA) created ${vault.toBase58()} (${sig})`);
  return vault;
}

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();

  const existing = await fetchHubPot(ctx.program);
  if (existing) {
    console.log("HubPotConfig already initialized:");
    console.log(`  otc   ${existing.otcMint}`);
    console.log(`  crclx ${existing.crclxMint}`);
    console.log(`  nvdax ${existing.nvdaxMint}`);
    console.log(`  spcxx ${existing.spcxxMint}`);
    return;
  }

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const otcMint = cfg.otcMint;
  if (otcMint.equals(PublicKey.default)) {
    throw new Error("Config.otc_mint unset — run mainnet-init-config.ts first");
  }

  console.log(
    `about to init_hub_pot with otc=${otcMint.toBase58()} crclx=${CRCLX_MINT_MAINNET.toBase58()} ` +
      `nvdax=${NVDAX_MINT_MAINNET.toBase58()} spcxx=${SPCXX_MINT_MAINNET.toBase58()}`,
  );
  if (has("--dry-run")) {
    console.log("dry-run: not creating vaults or sending a transaction");
    return;
  }

  const [vault] = vaultPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [otcVault, crclxVault, nvdaxVault, spcxxVault] = await Promise.all([
    ensureVault2022(ctx, vault, otcMint, "OTC"),
    ensureVault2022(ctx, vault, CRCLX_MINT_MAINNET, "CRCLx"),
    ensureVault2022(ctx, vault, NVDAX_MINT_MAINNET, "NVDAx"),
    ensureVault2022(ctx, vault, SPCXX_MINT_MAINNET, "SPCXx"),
  ]);

  const sig = await ctx.program.methods
    .initHubPot(otcMint, CRCLX_MINT_MAINNET, NVDAX_MINT_MAINNET, SPCXX_MINT_MAINNET)
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      treasuryState,
      vault,
      otcVault,
      crclxVault,
      nvdaxVault,
      spcxxVault,
    })
    .rpc();
  console.log(`init_hub_pot :: ${explorer(sig, "tx")}`);

  const pot = await fetchHubPot(ctx.program);
  console.log("HubPotConfig:", JSON.stringify(pot, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
