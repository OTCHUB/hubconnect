// Devnet Mock OTC Desks — Native Yield (Option B), step 1/2: provisions the `NativeYieldMock`
// PDA (see `sdk/src/pda.ts`'s `nativeYieldMockPda`) for every desk in `Config.desk_collection`.
//
// The real OTC Desks program (otcdesks.cash) has no devnet deployment, so otchub's
// "natively activated" badge (lib/otcNative.ts) and its per-desk payout vault balance can never
// be exercised on devnet. This mock stands in for that vault: a plain system-owned lamport
// account (no data, funded to the rent-exempt floor — exactly like the pot/vault PDAs already
// created by `initialize_config`) whose mere existence signals "native active" and whose balance
// is the simulated accrued native yield. No hub program instruction touches it; this and
// `devnet-native-yield-drip.ts` manage it entirely off-chain via plain System Program transfers.
//
//   npx ts-node -T scripts/devnet-native-yield-init.ts [--collection <pk>]
//
// Idempotent: desks whose mock vault already exists (balance ≥ the rent floor) are skipped.
// Run after devnet-mock-desks.ts; re-run any time new mock desks are minted.
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { fetchCollectionAssets, nativeYieldMockPda } from "../sdk/src";
import { devnetCtx, explorer, sendIxs, sol } from "./lib/devnet";

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const IXS_PER_TX = 15;

async function main() {
  const ctx = await devnetCtx();
  const given = arg("--collection", "");
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const collection = given ? new PublicKey(given) : cfg.deskCollection;
  if (collection.equals(PublicKey.default)) {
    throw new Error("Config.desk_collection unset — run devnet-mock-desks.ts first");
  }

  const assets = await fetchCollectionAssets(ctx.connection, collection);
  if (!assets.length) {
    console.log(`no desks in collection ${collection.toBase58()} — nothing to provision`);
    return;
  }
  const floor = await ctx.connection.getMinimumBalanceForRentExemption(0);
  const pdas = assets.map((a) => nativeYieldMockPda(ctx.program.programId, a)[0]);
  const infos = await ctx.connection.getMultipleAccountsInfo(pdas);

  const ixs: TransactionInstruction[] = [];
  let created = 0;
  infos.forEach((info, i) => {
    const bal = info?.lamports ?? 0;
    if (bal >= floor) return;
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: ctx.payer.publicKey,
        toPubkey: pdas[i],
        lamports: floor - bal,
      }),
    );
    created++;
  });

  if (!ixs.length) {
    console.log(`${assets.length} desk(s) already have a funded native-yield mock — nothing to do`);
    return;
  }
  for (let i = 0; i < ixs.length; i += IXS_PER_TX) {
    const sig = await sendIxs(ctx, ixs.slice(i, i + IXS_PER_TX));
    console.log(`funded ${Math.min(IXS_PER_TX, ixs.length - i)} mock vault(s) (${sig})`);
  }
  console.log(
    `native-yield mock ready :: ${created}/${assets.length} desk(s) funded to ${sol(floor)} rent floor`,
  );
  console.log(`example vault: ${explorer(pdas[0].toBase58())}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
