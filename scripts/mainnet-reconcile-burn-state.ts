// One-time historical backfill for the pre-fix `BurnState.total_hub_burned` gap (§ledgerDrift):
// `activate_tier` / `upgrade_tier` / `activate_tier_otc` / `upgrade_tier_otc` always burned real
// $HUB via `BurnChecked` but never bumped the ledger before this program version added
// `burn: Account<BurnState>` to those four instructions. Sets `total_hub_burned` once to
// `HUB_MAX_SUPPLY_UNITS - Mint.supply` (the on-chain source of truth for cumulative burns since
// $HUB's mint authority was revoked after genesis).
//
//   npx ts-node -T scripts/mainnet-reconcile-burn-state.ts [--dry-run]
//
// Authority-gated: must sign with `HUB_MAINNET_WALLET` = `Config.authority`. Safe to re-run —
// the on-chain instruction reverts with `BurnAlreadyReconciled` (treated here as a clean, silent
// exit) once `total_hub_burned` already reflects `HUB_MAX_SUPPLY_UNITS - Mint.supply`.
import { burnPda } from "../sdk/src";
import { explorer, mainnetCtx, parseFlags } from "./lib/mainnet";

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [burn] = burnPda(ctx.program.programId);
  const before = await ctx.program.account.burnState.fetch(burn);
  console.log(`BurnState.totalHubBurned (before): ${before.totalHubBurned.toString()}`);

  if (has("--dry-run")) {
    console.log("dry-run: not sending a transaction");
    return;
  }

  try {
    const sig = await ctx.program.methods
      .reconcileBurnState()
      .accountsPartial({
        authority: ctx.payer.publicKey,
        config: ctx.config,
        burn,
        hubMint: cfg.hubMint,
      })
      .rpc();
    console.log(`reconcile_burn_state :: ${explorer(sig, "tx")}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("BurnAlreadyReconciled")) {
      console.log("already reconciled — total_hub_burned already reflects max - Mint.supply");
      return;
    }
    throw e;
  }

  const after = await ctx.program.account.burnState.fetch(burn);
  console.log(`BurnState.totalHubBurned (after):  ${after.totalHubBurned.toString()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
