// One-time mainnet bootstrap for the creator-fee flywheel (§A6.3): creates `CreatorFeeState`
// and its vault-owned $OTC (Token-2022) token account so the mainnet creator-fee keeper
// (`keeper/creator-fee/`, `HUB_KEEPER_KEYPAIR=keeper/keys/mainnet-creator-fee-keeper.json`) has
// something to read/act on. Mirrors `devnet-init-creator-fee.ts`; the $OTC vault is a real
// Token-2022 ATA here (`ata2022`/`createAtaIdempotent2022`) instead of devnet's legacy-SPL one.
// Signs with the deployer (HUB_MAINNET_WALLET = Config.authority on mainnet).
//
//   npx ts-node -T scripts/mainnet-init-creator-fee.ts [--keeper <pubkey>] [--threshold <otc>] [--dry-run]
//
// `--keeper` defaults to `keeper/keys/mainnet-creator-fee-keeper.json`'s pubkey — this becomes
// `CreatorFeeState.authority`, the only signer `draw_creator_fee_leg`/
// `record_creator_fee_burn_result`/`_stack`/`_ops` accept. `--threshold` defaults to the spec
// default of 1,000 $OTC (docs/hubconnect-spec.md §B2).
import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { creatorFeePda, potPda } from "../sdk/src";
import {
  ata2022,
  createAtaIdempotent2022,
  explorer,
  loadKeypair,
  mainnetCtx,
  parseFlags,
  sendIxs,
} from "./lib/mainnet";

const OTC_DECIMALS = 6;

async function main() {
  const { get, has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();
  const [creatorFeeKey] = creatorFeePda(ctx.program.programId);

  const existing = await ctx.connection.getAccountInfo(creatorFeeKey);
  if (existing) {
    const state = await ctx.program.account.creatorFeeState.fetch(creatorFeeKey);
    console.log(`CreatorFeeState already initialized at ${creatorFeeKey.toBase58()}`);
    console.log(`  authority: ${state.authority.toBase58()}`);
    console.log(`  clearThresholdUnits: ${state.clearThresholdUnits.toString()}`);
    return;
  }

  const keeperArg = get("--keeper");
  const keeperPubkey = keeperArg
    ? new PublicKey(keeperArg)
    : loadKeypair("keeper/keys/mainnet-creator-fee-keeper.json").publicKey;

  const thresholdOtc = Number(get("--threshold") ?? 1_000);
  const clearThresholdUnits = new BN(thresholdOtc).mul(new BN(10 ** OTC_DECIMALS));

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.otcMint.equals(PublicKey.default)) {
    throw new Error("Config.otc_mint unset — run mainnet-init-config.ts first");
  }
  const [pot] = potPda(ctx.program.programId);
  const creatorFeeVault = ata2022(pot, cfg.otcMint);
  const vaultInfo = await ctx.connection.getAccountInfo(creatorFeeVault);
  const createVaultIx = vaultInfo
    ? null
    : createAtaIdempotent2022(ctx.payer.publicKey, pot, cfg.otcMint);

  console.log(
    `about to init CreatorFeeState — keeper(authority) ${keeperPubkey.toBase58()}, ` +
      `clear_threshold ${thresholdOtc} $OTC, vault ${creatorFeeVault.toBase58()}`,
  );
  if (has("--dry-run")) {
    console.log("dry-run: not creating vault or sending a transaction");
    return;
  }

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

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
