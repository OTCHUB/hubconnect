// One-time devnet bootstrap for the §A5.1 HUB Pot "M.I.M ETF" basket (§B5.1 mock).
//   npx ts-node -T scripts/devnet-hub-pot-mint.ts [--supply 1000000000] [--decimals 6]
// 1. Creates 3 new devnet-only SPL mints — CRCLx, OpenAI, Anthropic (test stand-ins for the
//    13-stock treasury-desk basket the mainnet pot actually holds) — via the same
//    InitializeMint2 + mint-to-payer helper `devnet-hub-mint.ts` already uses for $HUB/$OTC.
// 2. Ensures the 4 vault-owned token accounts `init_hub_pot` requires (ATA of the `vault` PDA
//    for each of otc/crclx/openai/anthropic — the on-chain check only verifies mint + owner,
//    not that it's the canonical ATA, but reusing the ATA program keeps every vault
//    deterministic and easy to inspect on an explorer).
// 3. Calls `init_hub_pot` once (no update path afterwards — same no-migration pattern as
//    `init_otc_pot`). Idempotent: exits early if `HubPotConfig` already exists.
// Needed before the Faucet page's M.I.M ETF component drips (CRCLx/OpenAI/Anthropic) can work —
// `useHubPot()` / the faucet Worker both read these mint addresses live off `HubPotConfig`.
import { PublicKey, Transaction } from "@solana/web3.js";
import { fetchHubPot, treasuryPda, vaultPda } from "../sdk/src";
import { ata, createAtaIdempotent, devnetCtx, explorer, type Ctx } from "./lib/devnet";
import { createHubMint } from "./devnet-hub-mint";

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/** Ensure `owner`'s ATA for `mint` exists; returns the address regardless. */
async function ensureVault(ctx: Ctx, owner: PublicKey, mint: PublicKey, label: string) {
  const vault = ata(owner, mint);
  if (await ctx.connection.getAccountInfo(vault)) return vault;
  const ix = createAtaIdempotent(ctx.payer.publicKey, owner, mint);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  ${label} vault (ATA of vault PDA) created ${vault.toBase58()} (${sig})`);
  return vault;
}

async function main() {
  const ctx = await devnetCtx();
  const decimals = Number(arg("--decimals", "6"));
  const supply = BigInt(arg("--supply", "1000000000"));

  const existing = await fetchHubPot(ctx.program);
  if (existing) {
    console.log("HubPotConfig already initialized:");
    console.log(`  otc       ${existing.otcMint}`);
    console.log(`  crclx     ${existing.crclxMint}`);
    console.log(`  openai    ${existing.openaiMint}`);
    console.log(`  anthropic ${existing.anthropicMint}`);
    return;
  }

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const otcMint = cfg.otcMint;
  if (otcMint.equals(PublicKey.default)) {
    throw new Error("Config.otc_mint unset — run devnet-otc-mint.ts first");
  }

  const mints: Record<"crclx" | "openai" | "anthropic", PublicKey> = {} as never;
  for (const key of ["crclx", "openai", "anthropic"] as const) {
    const { mint, sig } = await createHubMint(ctx, decimals, supply);
    mints[key] = mint;
    console.log(`${key.toUpperCase()} devnet mint ${mint.toBase58()} (${sig})`);
  }

  const [vault] = vaultPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [otcVault, crclxVault, openaiVault, anthropicVault] = await Promise.all([
    ensureVault(ctx, vault, otcMint, "OTC"),
    ensureVault(ctx, vault, mints.crclx, "CRCLx"),
    ensureVault(ctx, vault, mints.openai, "OpenAI"),
    ensureVault(ctx, vault, mints.anthropic, "Anthropic"),
  ]);

  const sig = await ctx.program.methods
    .initHubPot(otcMint, mints.crclx, mints.openai, mints.anthropic)
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      treasuryState,
      vault,
      otcVault,
      crclxVault,
      openaiVault,
      anthropicVault,
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
