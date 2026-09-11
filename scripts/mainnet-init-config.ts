// One-time `initialize_config` on mainnet-beta. Config/Pot/BurnState/TreasuryState/Epoch[0] are
// singleton PDAs created with Anchor's `init` constraint — unlike devnet, there is no reset path
// (`devnet_reset` only exists behind the `mock-jupiter` Cargo feature, never present in a mainnet
// build), so this can only ever run once per program deploy. Get every argument right first.
//
//   npx ts-node -T scripts/mainnet-init-config.ts --hub-mint <pubkey> --dry-run
//   npx ts-node -T scripts/mainnet-init-config.ts --hub-mint <pubkey> --yes
//   npx ts-node -T scripts/mainnet-init-config.ts --hub-mint <pubkey> --ops-wallet <pk> --treasury <pk> --yes
//
// `--hub-mint` is required and has no default: $HUB launches *through* the OTC launcher
// (otcdesks.cash/launcher, see README "What is $HUB?"), not minted by this repo — there is no
// mainnet equivalent of devnet-hub-mint.ts. Every other OTC-side reference (otc_mint, otc_program,
// otc_desk_pot, desk_collection, usdc_mint) defaults to the real, already-live mainnet addresses
// in scripts/lib/mainnet.ts; override with the matching flag only if one of them ever changes.
// `--ops-wallet`/`--treasury` default to the signer (HUB_MAINNET_WALLET) — pass the real multisig
// addresses once they exist (see the mainnet launch checklist).
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { USDC_MINT } from "../sdk/src/constants";
import { burnPda, epochPda, potPda, treasuryPda, vaultPda } from "../sdk/src";
import {
  CRCLX_MINT_MAINNET,
  NVDAX_MINT_MAINNET,
  OTC_DESKS_COLLECTION_MAINNET,
  OTC_DESK_POT_MAINNET,
  OTC_MINT_MAINNET,
  OTC_PROGRAM_MAINNET,
  SPCXX_MINT_MAINNET,
  explorer,
  mainnetCtx,
  parseFlags,
} from "./lib/mainnet";

async function main() {
  const { get, has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx(get("--rpc"));

  const hubMintArg = get("--hub-mint");
  if (!hubMintArg) {
    throw new Error(
      "--hub-mint is required — $HUB launches through the OTC launcher (otcdesks.cash/launcher); " +
        "pass its mint address once the launch has happened. This script never creates a mint.",
    );
  }
  const hubMint = new PublicKey(hubMintArg);
  if (!(await ctx.connection.getAccountInfo(hubMint))) {
    throw new Error(`--hub-mint ${hubMint.toBase58()} does not exist on mainnet-beta`);
  }

  const opsWallet = new PublicKey(get("--ops-wallet") ?? ctx.payer.publicKey.toBase58());
  const treasury = new PublicKey(get("--treasury") ?? ctx.payer.publicKey.toBase58());
  const otcMint = new PublicKey(get("--otc-mint") ?? OTC_MINT_MAINNET);
  const usdcMint = new PublicKey(get("--usdc-mint") ?? USDC_MINT);
  const otcProgram = new PublicKey(get("--otc-program") ?? OTC_PROGRAM_MAINNET);
  const otcDeskPot = new PublicKey(get("--otc-desk-pot") ?? OTC_DESK_POT_MAINNET);
  const deskCollection = new PublicKey(get("--desk-collection") ?? OTC_DESKS_COLLECTION_MAINNET);
  const minPotThresholdLamports = Number(get("--min-pot-threshold") ?? 0); // 0 -> on-chain 0.1 SOL

  const already = await ctx.connection.getAccountInfo(ctx.config);
  if (already) {
    console.log(`Config already initialized at ${ctx.config.toBase58()} — nothing to do`);
    return;
  }

  console.log("about to initialize_config on MAINNET-BETA with:");
  console.log(`  authority       = ${ctx.payer.publicKey.toBase58()} (signer)`);
  console.log(`  ops_wallet      = ${opsWallet.toBase58()}`);
  console.log(`  treasury        = ${treasury.toBase58()}`);
  console.log(`  hub_mint        = ${hubMint.toBase58()}`);
  console.log(`  otc_mint        = ${otcMint.toBase58()}`);
  console.log(`  usdc_mint       = ${usdcMint.toBase58()}`);
  console.log(`  otc_program     = ${otcProgram.toBase58()}`);
  console.log(`  otc_desk_pot    = ${otcDeskPot.toBase58()}`);
  console.log(`  desk_collection = ${deskCollection.toBase58()}`);
  console.log(
    `  min_pot_threshold_lamports = ${minPotThresholdLamports || "0 (on-chain default: 0.1 SOL)"}`,
  );
  console.log(
    `  (M.I.M ETF basket is set up separately by mainnet-init-hub-pot.ts: ` +
      `crclx=${CRCLX_MINT_MAINNET.toBase58()} nvdax=${NVDAX_MINT_MAINNET.toBase58()} spcxx=${SPCXX_MINT_MAINNET.toBase58()})`,
  );

  if (has("--dry-run")) {
    console.log("dry-run: not sending a transaction");
    return;
  }
  if (!has("--yes")) {
    throw new Error("initialize_config is irreversible on mainnet — re-run with --yes to confirm");
  }

  const id = ctx.program.programId;
  const [pot] = potPda(id);
  const [burn] = burnPda(id);
  const [treasuryState] = treasuryPda(id);
  const [vault] = vaultPda(id);
  const [epoch0] = epochPda(id, 0);

  const sig = await ctx.program.methods
    .initializeConfig({
      opsWallet,
      treasury,
      otcProgram,
      otcDeskPot,
      deskCollection,
      hubMint,
      otcMint,
      usdcMint,
      minPotThresholdLamports: new BN(minPotThresholdLamports),
    })
    .accountsPartial({
      payer: ctx.payer.publicKey,
      config: ctx.config,
      pot,
      burn,
      treasuryState,
      vault,
      epoch0,
    })
    .rpc();

  console.log(`initialize_config :: ${explorer(sig, "tx")}`);
  console.log(`config = ${ctx.config.toBase58()}  ${explorer(ctx.config.toBase58())}`);
  console.log(
    "next: mainnet-treasury-float.ts, mainnet-init-tokenomics.ts, mainnet-init-otc-pot.ts, mainnet-init-hub-pot.ts",
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
