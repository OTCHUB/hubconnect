// Re-points devnet mint authorities + the Core desk collection's UpdateDelegate to the faucet
// Worker's own keypair, so otchub.dev/drip can mint $HUB/$OTC/CRCLx/NVDAx/SPCXx and
// mint Mock OTC Desk NFTs into Config.desk_collection without ever holding the deployer's key.
//   npx ts-node -T scripts/devnet-faucet-authority.ts <faucetPubkey> --yes [--sol 2]
//
// 1. SPL mint authority: `SetAuthority(MintTokens, faucet)` on $HUB/$OTC (from Config) and
//    CRCLx/NVDAx/SPCXx (from HubPotConfig) — idempotent, skips any mint already pointed at
//    the faucet, and refuses to touch one whose current authority isn't this deployer.
// 2. Core UpdateDelegate: adds the faucet as an `additionalDelegate` on Config.desk_collection so
//    its `CreateV1` calls (authority = faucet) are accepted by the mainnet-cloned collection —
//    creates the plugin if the collection doesn't have one yet, else appends (dedup) to the list.
// 3. Tops the faucet wallet up to `--sol` SOL (default 2) from the deployer — covers /drip +
//    /mint-desk tx fees, Core asset rent, and the SOL step-fee + $HUB burn `activate_tier` needs.
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { publicKey as umiPk } from "@metaplex-foundation/umi";
import {
  addCollectionPlugin,
  fetchCollection,
  updateCollectionPlugin,
} from "@metaplex-foundation/mpl-core";
import { fetchHubPot, parseMint } from "../sdk/src";
import { TOKEN_PROGRAM_ID, devnetCtx, explorer, sol, type Ctx } from "./lib/devnet";

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/** spl-token `SetAuthority` (ix 6): authority_type 0 = MintTokens, new = Some(next). */
function setMintAuthorityIx(mint: PublicKey, current: PublicKey, next: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: current, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([6, 0, 1]), next.toBuffer()]),
  });
}

async function repointMint(ctx: Ctx, label: string, mint: PublicKey, faucet: PublicKey) {
  const info = await ctx.connection.getAccountInfo(mint);
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) {
    console.log(`  ${label} ${mint.toBase58()}: not an SPL mint — skipped`);
    return null;
  }
  const { mintAuthority } = parseMint(mint, info.data);
  if (mintAuthority === faucet.toBase58()) {
    console.log(`  ${label} ${mint.toBase58()}: already faucet-owned`);
    return null;
  }
  if (mintAuthority !== ctx.payer.publicKey.toBase58()) {
    throw new Error(
      `${label} mint authority is ${mintAuthority}, not the deployer — can't re-point`,
    );
  }
  return setMintAuthorityIx(mint, ctx.payer.publicKey, faucet);
}

/** Adds `faucet` to Config.desk_collection's UpdateDelegate plugin (creating it if absent). */
async function ensureDelegate(ctx: Ctx, faucet: PublicKey, collection: PublicKey) {
  const col = await fetchCollection(ctx.umi, umiPk(collection.toBase58()));
  const existing = (col.updateDelegate?.additionalDelegates ?? []).map((k) => k.toString());
  if (existing.includes(faucet.toBase58())) {
    console.log(`  desk_collection ${collection.toBase58()}: faucet already a delegate`);
    return;
  }
  const additionalDelegates = [...existing, faucet.toBase58()].map((k) => umiPk(k));
  const plugin = { type: "UpdateDelegate" as const, additionalDelegates };
  const builder = col.updateDelegate
    ? updateCollectionPlugin(ctx.umi, { collection: umiPk(collection.toBase58()), plugin })
    : addCollectionPlugin(ctx.umi, { collection: umiPk(collection.toBase58()), plugin });
  const { signature } = await builder.sendAndConfirm(ctx.umi);
  console.log(
    `  desk_collection ${collection.toBase58()}: faucet added as delegate (${Buffer.from(signature).toString("hex").slice(0, 16)}…)`,
  );
}

async function main() {
  const faucetArg = process.argv[2];
  if (!faucetArg || faucetArg.startsWith("--")) {
    throw new Error("usage: devnet-faucet-authority.ts <faucetPubkey> --yes [--sol 2]");
  }
  const faucet = new PublicKey(faucetArg);
  const topUpSol = Number(arg("--sol", "2"));
  if (!process.argv.includes("--yes")) {
    throw new Error("re-points live devnet mint authorities: re-run with --yes to confirm");
  }

  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const hubPot = await fetchHubPot(ctx.program);
  if (!hubPot) throw new Error("HubPotConfig not initialized — run devnet-hub-pot-mint.ts first");

  console.log(`re-pointing mint authorities → faucet ${faucet.toBase58()}`);
  const mints: [string, PublicKey][] = [
    ["$HUB", cfg.hubMint],
    ["$OTC", cfg.otcMint],
    ["CRCLx", new PublicKey(hubPot.crclxMint)],
    ["NVDAx", new PublicKey(hubPot.nvdaxMint)],
    ["SPCXx", new PublicKey(hubPot.spcxxMint)],
  ];
  const ixs = (
    await Promise.all(mints.map(([label, mint]) => repointMint(ctx, label, mint, faucet)))
  ).filter((ix): ix is TransactionInstruction => ix !== null);
  if (ixs.length) {
    const sig = await ctx.provider.sendAndConfirm(new Transaction().add(...ixs), [ctx.payer]);
    console.log(`  ${ixs.length} mint(s) re-pointed → ${explorer(sig, "tx")}`);
  }

  if (!cfg.deskCollection.equals(PublicKey.default)) {
    console.log(`adding faucet as Core UpdateDelegate on desk_collection`);
    await ensureDelegate(ctx, faucet, cfg.deskCollection);
  } else {
    console.log(
      "Config.desk_collection unset — skip UpdateDelegate step (run devnet-mock-desks.ts first)",
    );
  }

  const bal = await ctx.connection.getBalance(faucet);
  const target = topUpSol * LAMPORTS_PER_SOL;
  if (bal < target) {
    const topUp = target - bal;
    const sig = await ctx.provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ctx.payer.publicKey,
          toPubkey: faucet,
          lamports: topUp,
        }),
      ),
      [ctx.payer],
    );
    console.log(`funded faucet +${sol(topUp)} → ${explorer(sig, "tx")}`);
  } else {
    console.log(`faucet already has ${sol(bal)} ≥ target ${sol(target)}`);
  }

  console.log(`faucet ${faucet.toBase58()} ready · ${explorer(faucet.toBase58())}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
