// One-time mainnet bootstrap for `HubPotInflowState` (§A5.1) — must run once, after
// `mainnet-init-hub-pot.ts` and before the first `mainnet-recognize-hub-pot-inflow.ts` call, on
// the same program version that shipped `recognize_hub_pot_inflow`.
//
//   npx ts-node -T scripts/mainnet-init-hub-pot-inflow.ts [--dry-run]
//
// Idempotent: exits early if `HubPotInflowState` already exists. Authority-gated
// (`has_one = authority` on `Config`) — signs with `HUB_MAINNET_WALLET`, same key as
// `mainnet-init-hub-pot.ts`.
import { fetchHubPotInflow, hubPotInflowPda } from "../sdk/src";
import { explorer, mainnetCtx, parseFlags } from "./lib/mainnet";

const json = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2);

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();
  const [inflow] = hubPotInflowPda(ctx.program.programId);

  const existing = await fetchHubPotInflow(ctx.program);
  if (existing) {
    console.log("HubPotInflowState already initialized:", json(existing));
    return;
  }

  console.log(`about to init_hub_pot_inflow at ${inflow.toBase58()}`);
  if (has("--dry-run")) {
    console.log("dry-run: not sending a transaction");
    return;
  }

  const sig = await ctx.program.methods
    .initHubPotInflow()
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config, inflow })
    .rpc();
  console.log(`init_hub_pot_inflow :: ${explorer(sig, "tx")}`);

  const state = await fetchHubPotInflow(ctx.program);
  console.log("HubPotInflowState:", json(state));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
