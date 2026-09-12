// Recurring, permissionless reconciliation for §A5.1's HUB Pot buckets — recognizes whatever the
// OTC Desks launcher's automatic pro-rata holder payout deposited straight into the vault since
// the last run (bypassing `fund_hub_pot` entirely), skims `Config.protocol_fee_bp` to
// `ops_wallet`, and credits the net remainder as pending yield for HUB-activated desks.
//
// Safe to run on a schedule (same PM2 cadence as `keeper/otc-buy`) — a no-op call (nothing new
// landed in any of the 4 vaults since the last recognition) fails on-chain with `NoHubPotInflow`,
// which this script treats as a clean, silent exit rather than an error.
//
//   npx ts-node -T scripts/mainnet-recognize-hub-pot-inflow.ts [--dry-run]
//
// Requires `mainnet-init-hub-pot.ts` and `mainnet-init-hub-pot-inflow.ts` to have already run
// once. No special key: signs with `HUB_MAINNET_WALLET`, but any funded keypair works identically
// — the skim rate and destination are fixed by on-chain `Config`, not by the caller.
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  fetchHubPot,
  fetchHubPotInflow,
  hubPotInflowPda,
  hubPotPda,
  treasuryPda,
  vaultPda,
} from "../sdk/src";
import {
  ata2022,
  createAtaIdempotent2022,
  explorer,
  mainnetCtx,
  parseFlags,
  TOKEN_2022_PROGRAM_ID,
  type Ctx,
} from "./lib/mainnet";

async function ensureOpsAta2022(ctx: Ctx, opsWallet: PublicKey, mint: PublicKey, label: string) {
  const acc = ata2022(opsWallet, mint);
  if (await ctx.connection.getAccountInfo(acc)) return acc;
  const ix = createAtaIdempotent2022(ctx.payer.publicKey, opsWallet, mint);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  ops ${label} ATA created ${acc.toBase58()} (${sig})`);
  return acc;
}

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();

  const hubPotState = await fetchHubPot(ctx.program);
  if (!hubPotState) throw new Error("HubPotConfig missing — run mainnet-init-hub-pot.ts first");
  const inflowState = await fetchHubPotInflow(ctx.program);
  if (!inflowState) throw new Error("HubPotInflowState missing — run mainnet-init-hub-pot-inflow.ts first");

  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [hubPot] = hubPotPda(ctx.program.programId);
  const [inflow] = hubPotInflowPda(ctx.program.programId);
  const [vault] = vaultPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);

  const otcMint = new PublicKey(hubPotState.otcMint);
  const crclxMint = new PublicKey(hubPotState.crclxMint);
  const nvdaxMint = new PublicKey(hubPotState.nvdaxMint);
  const spcxxMint = new PublicKey(hubPotState.spcxxMint);

  if (has("--dry-run")) {
    console.log("dry-run: not touching ops ATAs or sending a transaction");
    return;
  }

  const [opsOtc, opsCrclx, opsNvdax, opsSpcxx] = await Promise.all([
    ensureOpsAta2022(ctx, cfg.opsWallet, otcMint, "OTC"),
    ensureOpsAta2022(ctx, cfg.opsWallet, crclxMint, "CRCLx"),
    ensureOpsAta2022(ctx, cfg.opsWallet, nvdaxMint, "NVDAx"),
    ensureOpsAta2022(ctx, cfg.opsWallet, spcxxMint, "SPCXx"),
  ]);

  try {
    const sig = await ctx.program.methods
      .recognizeHubPotInflow()
      .accountsPartial({
        payer: ctx.payer.publicKey,
        config: ctx.config,
        hubPot,
        inflow,
        treasuryState,
        vault,
        otcMint,
        crclxMint,
        nvdaxMint,
        spcxxMint,
        otcVault: new PublicKey(hubPotState.otcVault),
        crclxVault: new PublicKey(hubPotState.crclxVault),
        nvdaxVault: new PublicKey(hubPotState.nvdaxVault),
        spcxxVault: new PublicKey(hubPotState.spcxxVault),
        opsOtc,
        opsCrclx,
        opsNvdax,
        opsSpcxx,
        otcTokenProgram: TOKEN_2022_PROGRAM_ID,
        crclxTokenProgram: TOKEN_2022_PROGRAM_ID,
        nvdaxTokenProgram: TOKEN_2022_PROGRAM_ID,
        spcxxTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log(`recognize_hub_pot_inflow :: ${explorer(sig, "tx")}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("NoHubPotInflow")) {
      console.log("no new inflow since the last recognition — nothing to do");
      return;
    }
    throw e;
  }

  const after = await fetchHubPot(ctx.program);
  console.log("HubPotConfig (after):", JSON.stringify(after, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
