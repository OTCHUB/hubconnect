// One-time devnet provisioning for `init_tier_fee_config` (§A4 revised) — creates the
// `TierFeeConfig` PDA (["tier_fee"]) that `activate_tier` / `upgrade_tier` / `activate_tier_otc` /
// `upgrade_tier_otc` all now read for the ascending per-tier SOL fee (T1 0.2 / T2 0.3 / T3 0.4 /
// T4 0.5 SOL), seeded from `TIER_STEP_FEE_LAMPORTS`. Required before any of those four
// instructions will succeed against a devnet deploy carrying the tiered-fee upgrade — mirrors
// `scripts/mainnet-init-tier-fee.ts` exactly, just against the devnet deployer/cluster (see
// `scripts/lib/devnet.ts`). Idempotent — no-ops (logs the existing schedule) if the PDA already
// exists.
//
//   npx ts-node -T scripts/devnet-init-tier-fee.ts [--dry-run]
//
// Signs with the devnet deployer (= Config.authority on devnet, HUB_WALLET or
// ~/.config/solana/hubconnect-devnet.json — admin-gated, `has_one = authority` on
// `InitTierFeeConfig`).
import { tierFeePda } from "../sdk/src/pda";
import { devnetCtx, explorer } from "./lib/devnet";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const ctx = await devnetCtx();
  const [tierFee] = tierFeePda(ctx.program.programId);

  const existing = await ctx.program.account.tierFeeConfig.fetchNullable(tierFee);
  if (existing) {
    console.log(`TierFeeConfig already initialized at ${tierFee.toBase58()}:`);
    existing.tierStepFeeLamports.forEach((lamports: { toString(): string }, i: number) =>
      console.log(`  T${i + 1}: ${lamports.toString()} lamports`),
    );
    return;
  }

  console.log(`TierFeeConfig not yet initialized — will create ${tierFee.toBase58()}`);
  if (dryRun) {
    console.log("dry-run: not sending a transaction");
    return;
  }

  const sig = await ctx.program.methods
    .initTierFeeConfig()
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config, tierFee })
    .rpc();
  console.log(`init_tier_fee_config :: ${explorer(sig, "tx")}`);

  const created = await ctx.program.account.tierFeeConfig.fetch(tierFee);
  created.tierStepFeeLamports.forEach((lamports: { toString(): string }, i: number) =>
    console.log(`  T${i + 1}: ${lamports.toString()} lamports`),
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
