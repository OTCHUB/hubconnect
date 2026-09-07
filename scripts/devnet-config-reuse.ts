// After a fresh devnet deploy (new program id), re-point Config at the devnet fixtures that live
// outside the program — the $HUB SPL mint and the mock "OTC Desks" Core collection — and recycle
// the 10% ops slice of test step fees into the payer.
//   npx ts-node -T scripts/devnet-config-reuse.ts --hub-mint <pk> --collection <pk>
import { PublicKey } from "@solana/web3.js";
import { devnetCtx, setConfigPubkey } from "./lib/devnet";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? new PublicKey(process.argv[i + 1]) : null;
}

async function main() {
  const ctx = await devnetCtx();
  const hubMint = arg("--hub-mint");
  const collection = arg("--collection");
  if (!hubMint && !collection) throw new Error("pass --hub-mint <pk> and/or --collection <pk>");
  if (hubMint) await setConfigPubkey(ctx, "hubMint", hubMint);
  if (collection) await setConfigPubkey(ctx, "deskCollection", collection);
  await setConfigPubkey(ctx, "opsWallet", ctx.payer.publicKey);
  const c = await ctx.program.account.config.fetch(ctx.config);
  console.log(`config.hub_mint        = ${c.hubMint.toBase58()}`);
  console.log(`config.desk_collection = ${c.deskCollection.toBase58()}`);
  console.log(`config.ops_wallet      = ${c.opsWallet.toBase58()}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
