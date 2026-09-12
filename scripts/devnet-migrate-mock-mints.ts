// One-time devnet migration: the live $OTC/CRCLx/NVDAx/SPCXx mock mints' authority is the
// faucet wallet FcZdMHJG2pNPZ1FWVufxPwUxQeru6rcC7WbTaZuHXkNq, whose keypair was never persisted
// locally (see devnet-mock-token-metadata.ts's doc comment) — so Metaplex metadata (which
// requires the *creating* payer to hold mint authority) can never be attached to them. This
// script replaces all 4 with fresh deployer-owned mints, attaches metadata immediately, then
// repoints Config.otc_mint (+ OtcPotState.otc_vault via set_otc_vault) and each HubPotConfig
// basket bucket (via update_hub_pot_mint) at the new mints. Run
// devnet-faucet-authority.ts afterwards to hand mint authority back to the faucet wallet.
//   npx ts-node -T scripts/devnet-migrate-mock-mints.ts --yes
import { PublicKey } from "@solana/web3.js";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { fetchHubPot, hubPotPda, otcPotPda, potPda, treasuryPda, vaultPda } from "../sdk/src";
import { ata, createAtaIdempotent, devnetCtx, sendIxs, type Ctx } from "./lib/devnet";
import { createHubMint, TOKEN_PROGRAM_ID } from "./devnet-hub-mint";
import { createMetadataV3, metadataPda } from "./devnet-hub-metadata";

const DECIMALS = 6;
const SUPPLY = 1_000_000_000n;

const TOKEN_META = {
  otc: {
    name: "OTC Desks (mock)",
    symbol: "OTC",
    description:
      "Devnet mock of $OTC — the §A5 90% yield leg desk owners claim via claim_yield. Never deployed to mainnet as its own SPL token; test-only stand-in for faucet drips.",
    image: "https://otchub.dev/stocks/OTC.png",
  },
  crclx: {
    name: "Circle xStock (mock)",
    symbol: "CRCLx",
    description: "Devnet mock of Backed Finance's tokenized Circle (CRCL) xStock.",
    image: "https://otchub.dev/stocks/CRCLx.png",
  },
  nvdax: {
    name: "NVIDIA xStock (mock)",
    symbol: "NVDAx",
    description: "Devnet mock of Backed Finance's tokenized NVIDIA (NVDA) xStock.",
    image: "https://otchub.dev/stocks/NVDAx.png",
  },
  spcxx: {
    name: "SpaceX xStock (mock)",
    symbol: "SPCXx",
    description: "Devnet mock of Backed Finance's tokenized SpaceX (SPCX) xStock.",
    image: "https://otchub.dev/stocks/SPCXx.png",
  },
} as const;

async function uploadMetadataJson(ctx: Ctx, key: keyof typeof TOKEN_META) {
  const meta = TOKEN_META[key];
  const irys = await Uploader(Solana).withWallet(Array.from(ctx.payer.secretKey));
  const json = {
    name: meta.name,
    symbol: meta.symbol,
    description: meta.description,
    image: meta.image,
    external_url: "https://otchub.dev",
  };
  const buf = Buffer.from(JSON.stringify(json, null, 2));
  const receipt = await irys.upload(buf, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  return `https://gateway.irys.xyz/${receipt.id}`;
}

async function createMint(ctx: Ctx, key: keyof typeof TOKEN_META) {
  const meta = TOKEN_META[key];
  const { mint, sig } = await createHubMint(ctx, DECIMALS, SUPPLY);
  console.log(`${meta.symbol} new mint ${mint.toBase58()} (${sig})`);
  const uri = await uploadMetadataJson(ctx, key);
  const metaIx = createMetadataV3(mint, ctx.payer.publicKey, meta.name, meta.symbol, uri);
  const uriSig = await sendIxs(ctx, [metaIx]);
  console.log(`  metadata ${metadataPda(mint).toBase58()} created uri=${uri} (${uriSig})`);
  return mint;
}

async function main() {
  const ctx = await devnetCtx();
  if (!process.argv.includes("--yes")) {
    throw new Error("migrates live devnet mock mints: re-run with --yes to confirm");
  }
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const hubPot = await fetchHubPot(ctx.program);
  if (!hubPot) throw new Error("HubPotConfig not initialized");

  // 1. $OTC — Config.otc_mint + OtcPotState.otc_vault.
  const newOtc = await createMint(ctx, "otc");
  const [pot] = potPda(ctx.program.programId);
  const newOtcVault = ata(pot, newOtc);
  await sendIxs(ctx, [createAtaIdempotent(ctx.payer.publicKey, pot, newOtc)]);
  await ctx.program.methods
    .updateConfig({ otcMint: {} } as never, { pubkey: [newOtc] } as never)
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config })
    .rpc();
  console.log(`config.otc_mint -> ${newOtc.toBase58()}`);
  const [otcPotKey] = otcPotPda(ctx.program.programId);
  await ctx.program.methods
    .setOtcVault()
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      otcPot: otcPotKey,
      newOtcVault: newOtcVault,
    })
    .rpc();
  console.log(`otc_pot.otc_vault -> ${newOtcVault.toBase58()}`);

  // 2. CRCLx / NVDAx / SPCXx — HubPotConfig buckets via update_hub_pot_mint.
  const [vault] = vaultPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [hubPotKey] = hubPotPda(ctx.program.programId);
  const buckets: Array<{ key: "crclx" | "nvdax" | "spcxx"; variant: Record<string, object> }> = [
    { key: "crclx", variant: { crclx: {} } },
    { key: "nvdax", variant: { nvdax: {} } },
    { key: "spcxx", variant: { spcxx: {} } },
  ];
  for (const { key, variant } of buckets) {
    const newMint = await createMint(ctx, key);
    const newVault = ata(vault, newMint);
    await sendIxs(ctx, [createAtaIdempotent(ctx.payer.publicKey, vault, newMint)]);
    const oldMint = new PublicKey(hubPot[`${key}Mint` as keyof typeof hubPot] as string);
    const oldVault = new PublicKey(hubPot[`${key}Vault` as keyof typeof hubPot] as string);
    const sweepDest = ata(cfg.opsWallet, oldMint);
    const sig = await ctx.program.methods
      .updateHubPotMint(variant as never, newMint)
      .accountsPartial({
        authority: ctx.payer.publicKey,
        config: ctx.config,
        treasuryState,
        vault,
        hubPot: hubPotKey,
        oldMint,
        oldVault,
        sweepDest,
        newVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`hub_pot.${key}_mint -> ${newMint.toBase58()} (${sig})`);
  }

  const after = await ctx.program.account.config.fetch(ctx.config);
  const potAfter = await fetchHubPot(ctx.program);
  console.log("\nconfig.otc_mint", after.otcMint.toBase58());
  console.log("hub_pot", JSON.stringify(potAfter, null, 2));
  console.log(
    "\nnext: npx ts-node -T scripts/devnet-faucet-authority.ts <faucetPubkey> --yes",
  );
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
