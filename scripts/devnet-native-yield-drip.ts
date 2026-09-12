// Devnet Mock OTC Desks — Native Yield (Option B), step 2/2: the keeper/faucet that bumps every
// provisioned `NativeYieldMock` vault's balance to simulate ongoing native desk-pot accrual.
//
//   npx ts-node -T scripts/devnet-native-yield-drip.ts [--collection <pk>] [--sol-per-desk 0.01]
//
// Each run is one discrete "tick": every desk's mock vault (already funded by
// devnet-native-yield-init.ts — desks without one are skipped, not auto-created) receives a flat
// `--sol-per-desk` top-up (default ≈ the §A5 protocol-average raw desk-pot take
// (`DEFAULT_RAW_DESK_SOL` ≈ 0.1443 SOL/day, see otchub's lib/yield.ts) scaled down to a
// once-per-hour tick: 0.1443 / 24 ≈ 0.006 SOL). Schedule this on a matching cadence (cron/PM2) to
// approximate a continuous accrual rate — there is no on-chain clock or per-desk "last bumped"
// state to prorate from, since the mock is a plain lamport account, not an Anchor account.
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { fetchCollectionAssets, nativeYieldMockPda } from "../sdk/src";
import { devnetCtx, sendIxs, sol } from "./lib/devnet";

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const IXS_PER_TX = 15;
/** ≈ DEFAULT_RAW_DESK_SOL (0.1443 SOL/day, otchub lib/yield.ts) prorated to an hourly tick. */
const DEFAULT_SOL_PER_DESK_PER_TICK = 0.1443 / 24;

async function main() {
  const ctx = await devnetCtx();
  const given = arg("--collection", "");
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const collection = given ? new PublicKey(given) : cfg.deskCollection;
  if (collection.equals(PublicKey.default)) {
    throw new Error("Config.desk_collection unset — run devnet-mock-desks.ts first");
  }
  const lamportsPerDesk = Math.round(
    Number(arg("--sol-per-desk", String(DEFAULT_SOL_PER_DESK_PER_TICK))) * 1_000_000_000,
  );
  if (lamportsPerDesk <= 0) throw new Error("--sol-per-desk must be > 0");

  const assets = await fetchCollectionAssets(ctx.connection, collection);
  if (!assets.length) {
    console.log(`no desks in collection ${collection.toBase58()} — nothing to drip`);
    return;
  }
  const floor = await ctx.connection.getMinimumBalanceForRentExemption(0);
  const pdas = assets.map((a) => nativeYieldMockPda(ctx.program.programId, a)[0]);
  const infos = await ctx.connection.getMultipleAccountsInfo(pdas);

  const ixs: TransactionInstruction[] = [];
  let skipped = 0;
  infos.forEach((info, i) => {
    if (!info || info.lamports < floor) {
      skipped++;
      return;
    }
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: ctx.payer.publicKey,
        toPubkey: pdas[i],
        lamports: lamportsPerDesk,
      }),
    );
  });

  if (!ixs.length) {
    console.log(
      `no provisioned mock vaults among ${assets.length} desk(s) — run devnet-native-yield-init.ts first`,
    );
    return;
  }
  for (let i = 0; i < ixs.length; i += IXS_PER_TX) {
    const sig = await sendIxs(ctx, ixs.slice(i, i + IXS_PER_TX));
    console.log(`dripped ${Math.min(IXS_PER_TX, ixs.length - i)} vault(s) (${sig})`);
  }
  console.log(
    `native-yield drip :: +${sol(lamportsPerDesk)} × ${ixs.length} desk(s)` +
      (skipped ? ` · ${skipped} skipped (not provisioned)` : ""),
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
