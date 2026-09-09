// One-time devnet provisioning for `init_tokenomics` (§A7.1 supply plan) + the genesis 5%
// treasury carve-out: 2% yield reserve → `treasury_lock_vault` (program-recorded, no withdraw
// path), up to 2.5% desk-airdrop cap → `airdrop_vault` (released only via `claim_airdrop` /
// `distribute_airdrop` against a published Merkle root), 0.5% LP reserve → a separate
// payer-owned holding account (no dedicated program vault exists for this leg yet — see
// `RAYDIUM_CP_SWAP` phase-2 `build_lp_otc_locked`, which pulls from the treasury directly).
// The remaining ~95% stays in the payer's own $HUB ATA — the public / OTC-launch-curve supply.
//
//   npx ts-node -T scripts/devnet-init-tokenomics.ts
//
// Requires: Config.hub_mint already a real mint with the full supply minted to the payer
// (devnet-hub-mint.ts). Idempotent: no-ops (logs the existing split) if TokenomicsConfig
// already exists — that account has no update path once created.
import { PublicKey, Transaction } from "@solana/web3.js";
import { tokenomicsPda, treasuryPda, vaultPda } from "../sdk/src";
import { ata, devnetCtx, explorer, transferCheckedIx, type Ctx } from "./lib/devnet";
import { createTokenAccount } from "./devnet-treasury-float";

const BPS_DENOMINATOR = 10_000n;
const HUB_DECIMALS = 6;
const HUB_MAX_SUPPLY_UNITS = 1_000_000_000n * 10n ** BigInt(HUB_DECIMALS);
const YIELD_RESERVE_BP = 200n; // 2%
const LP_RESERVE_BP = 50n; // 0.5%
const AIRDROP_PER_DESK_UNITS = 10_000n * 10n ** BigInt(HUB_DECIMALS);
const AIRDROP_DESK_CAP = 2_500n;

async function fundVault(ctx: Ctx, hubMint: PublicKey, dest: PublicKey, amount: bigint, label: string) {
  if (amount === 0n) return;
  const source = ata(ctx.payer.publicKey, hubMint);
  const ix = transferCheckedIx(source, hubMint, dest, ctx.payer.publicKey, amount, HUB_DECIMALS);
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.payer]);
  console.log(`  ${label}: transferred ${amount} base units → ${dest.toBase58()} (${sig})`);
}

async function main() {
  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.hubMint.equals(PublicKey.default)) {
    throw new Error("Config.hub_mint unset — run devnet-hub-mint.ts first");
  }
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [vault] = vaultPda(ctx.program.programId);
  const [tokenomics] = tokenomicsPda(ctx.program.programId);

  const yieldReserveUnits = (HUB_MAX_SUPPLY_UNITS * YIELD_RESERVE_BP) / BPS_DENOMINATOR;
  const lpReserveUnits = (HUB_MAX_SUPPLY_UNITS * LP_RESERVE_BP) / BPS_DENOMINATOR;
  const airdropCapUnits = AIRDROP_PER_DESK_UNITS * AIRDROP_DESK_CAP;

  const existing = await ctx.program.account.tokenomicsConfig.fetchNullable(tokenomics);
  if (existing) {
    console.log(`TokenomicsConfig already initialized:`);
    console.log(`  treasury_lock_vault ${existing.treasuryLockVault.toBase58()} (2% floor, units recorded ${existing.treasuryLockUnits})`);
    console.log(`  airdrop_vault       ${existing.airdropVault.toBase58()} (cap ${airdropCapUnits} units)`);
    console.log(`  public_bp ${existing.publicBp} · treasury_lock_bp ${existing.treasuryLockBp} · team_bp ${existing.teamBp}`);
    return;
  }

  console.log(`carving out §A7.1 genesis 5%: yield ${yieldReserveUnits} · lp ${lpReserveUnits} · airdrop-cap ${airdropCapUnits} (base units)`);

  const { account: airdropVault } = await createTokenAccount(ctx, cfg.hubMint, vault);
  console.log(`airdrop_vault        ${airdropVault.toBase58()}`);
  const { account: treasuryLockVault } = await createTokenAccount(ctx, cfg.hubMint, vault);
  console.log(`treasury_lock_vault  ${treasuryLockVault.toBase58()}`);
  const { account: lpReserveVault } = await createTokenAccount(ctx, cfg.hubMint, ctx.payer.publicKey);
  console.log(`lp_reserve_vault     ${lpReserveVault.toBase58()} (payer-owned, no program vault yet)`);

  const sig = await ctx.program.methods
    .initTokenomics()
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      treasuryState,
      vault,
      airdropVault,
      treasuryLockVault,
      tokenomics,
    })
    .rpc();
  console.log(`init_tokenomics :: ${sig}`);
  console.log(`  ${explorer(sig, "tx")}`);

  await fundVault(ctx, cfg.hubMint, treasuryLockVault, yieldReserveUnits, "yield reserve (2%)");
  await fundVault(ctx, cfg.hubMint, airdropVault, airdropCapUnits, "desk airdrop cap (≤2.5%)");
  await fundVault(ctx, cfg.hubMint, lpReserveVault, lpReserveUnits, "LP reserve (0.5%)");

  const payerHub = await ctx.connection.getTokenAccountBalance(ata(ctx.payer.publicKey, cfg.hubMint));
  console.log(`payer $HUB remaining (public / bonding-curve supply): ${payerHub.value.amount} base units (${payerHub.value.uiAmountString})`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
