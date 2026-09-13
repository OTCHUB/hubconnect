// §A5.1 — manual admin trigger for `open_hub_pot_round`: snapshots the 4 HUB Pot bucket
// balances (`otc/crclx/nvdax/spcxx_pending_units`) accrued by `recognize_hub_pot_inflow` into a
// new claimable `HubPotRound`, then zeroes the pending counters. Permissionless on-chain (mirrors
// `open_reward_round`'s `--open` flag in mainnet-distribute.ts), but exposed here as its own
// script since the HUB Pot basket is a separate 4-mint pot from the 1-mint treasury reward that
// script drives. Not wired into any keeper/cron — same "run by hand when there's pending balance
// worth snapshotting" cadence as `mainnet-distribute.ts --reward --open`.
//
//   npx ts-node -T scripts/mainnet-open-hub-pot-round.ts [--dry-run]
import { fetchHubPot } from "../sdk/src";
import { explorer, mainnetCtx, parseFlags } from "./lib/mainnet";

const json = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2);

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();

  const pot = await fetchHubPot(ctx.program);
  if (!pot) throw new Error("HubPotConfig missing — run mainnet-init-hub-pot.ts first");

  console.log(`pending before open: otc=${pot.otcPendingUnits} crclx=${pot.crclxPendingUnits} ` +
    `nvdax=${pot.nvdaxPendingUnits} spcxx=${pot.spcxxPendingUnits}`);
  if (
    pot.otcPendingUnits === 0n &&
    pot.crclxPendingUnits === 0n &&
    pot.nvdaxPendingUnits === 0n &&
    pot.spcxxPendingUnits === 0n
  ) {
    console.log("nothing pending — open_hub_pot_round would revert with NoHubPotPending");
    return;
  }

  if (has("--dry-run")) {
    console.log(`dry-run: would open round #${pot.roundCount}`);
    return;
  }

  const sig = await ctx.program.methods
    .openHubPotRound()
    .accountsPartial({ payer: ctx.payer.publicKey, config: ctx.config })
    .rpc();
  console.log(`open_hub_pot_round :: ${explorer(sig, "tx")}`);

  const after = await fetchHubPot(ctx.program);
  console.log("HubPotConfig (after):", json(after));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
