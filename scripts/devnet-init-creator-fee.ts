// One-time devnet bootstrap for the creator-fee flywheel (§A6.3): creates `CreatorFeeState`
// and its vault-owned $OTC token account so the creator-fee keeper (`keeper/creator-fee/`) has
// something to read/act on. Signs with the devnet deployer (= Config.authority on devnet, see
// `scripts/lib/devnet.ts`).
//
//   npx ts-node -T scripts/devnet-init-creator-fee.ts [--keeper <pubkey>] [--threshold <otc>]
//
// `--keeper` defaults to `keeper/keys/devnet-creator-fee-keeper.json`'s pubkey (the dedicated
// devnet hot wallet already generated for this service) — this becomes `CreatorFeeState.authority`,
// the only signer `draw_creator_fee_leg`/`record_creator_fee_burn_result`/`_stack`/`_ops` accept.
// `--threshold` defaults to the spec default of 1,000 $OTC (docs/hubconnect-spec.md §B2).
import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import { creatorFeePda, potPda } from "../sdk/src";
import { ata, createAtaIdempotent, devnetCtx, explorer, loadKeypair, sendIxs } from "./lib/devnet";

const OTC_DECIMALS = 6;

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const ctx = await devnetCtx();
  const [creatorFeeKey] = creatorFeePda(ctx.program.programId);

  const existing = await ctx.connection.getAccountInfo(creatorFeeKey);
  if (existing) {
    const state = await ctx.program.account.creatorFeeState.fetch(creatorFeeKey);
    console.log(`CreatorFeeState already initialized at ${creatorFeeKey.toBase58()}`);
    console.log(`  authority: ${state.authority.toBase58()}`);
    console.log(`  clearThresholdUnits: ${state.clearThresholdUnits.toString()}`);
    return;
  }

  const keeperArg = flag("keeper");
  const keeperPubkey = keeperArg
    ? new PublicKey(keeperArg)
    : loadKeypair("keeper/keys/devnet-creator-fee-keeper.json").publicKey;

  const thresholdOtc = Number(flag("threshold") ?? 1_000);
  const clearThresholdUnits = new BN(thresholdOtc).mul(new BN(10 ** OTC_DECIMALS));

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.otcMint.equals(PublicKey.default)) {
    throw new Error("Config.otc_mint unset — run devnet:otc-mint first");
  }
  const [pot] = potPda(ctx.program.programId);
  const creatorFeeVault = ata(pot, cfg.otcMint);
  const vaultInfo = await ctx.connection.getAccountInfo(creatorFeeVault);
  const createVaultIx = vaultInfo ? null : createAtaIdempotent(ctx.payer.publicKey, pot, cfg.otcMint);

  console.log(
    `initializing CreatorFeeState — keeper(authority) ${keeperPubkey.toBase58()}, ` +
      `clear_threshold ${thresholdOtc} $OTC, vault ${creatorFeeVault.toBase58()}`,
  );

  const ix = await ctx.program.methods
    .initCreatorFeeState(keeperPubkey, clearThresholdUnits)
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      creatorFeeVault,
      creatorFeeState: creatorFeeKey,
    })
    .instruction();

  const sig = await sendIxs(ctx, [...(createVaultIx ? [createVaultIx] : []), ix]);
  console.log(`CreatorFeeState created at ${creatorFeeKey.toBase58()} (${explorer(sig, "tx")})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
