// One-time devnet provisioning for `init_treasury_float` (§A6.3/§A7.1 bridge): creates the three
// `["vault"]`-PDA-owned token accounts `finalize_epoch`'s synchronous Jupiter legs write into —
// vault_wsol (mint = WSOL), vault_hub (mint = Config.hub_mint), treasury_float_vault (mint =
// Config.hub_mint) — then calls `init_treasury_float` to record them on `TreasuryState`.
//
// Not associated-token accounts: vault_hub and treasury_float_vault share (owner, mint), which
// an ATA can't represent twice, so both are plain spl-token accounts at fresh keypair addresses.
//
//   npx ts-node -T scripts/devnet-treasury-float.ts
//
// Requires: Config.hub_mint already a real mint (devnet-hub-mint.ts) and `finalize_epoch`
// gates on `TreasuryState.vault_hub != default` — this must run before any finalize_epoch call.
// Idempotent: no-ops if TreasuryState.vault_hub is already set (no update path once created).
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { treasuryPda, vaultPda, WSOL_MINT } from "../sdk/src";
import { TOKEN_PROGRAM_ID, devnetCtx, explorer, type Ctx } from "./lib/devnet";

const TOKEN_ACCOUNT_SIZE = 165;

/** spl-token `InitializeAccount3` (ix 18): account · mint · owner (no Rent sysvar needed). */
function initializeAccount3(account: PublicKey, mint: PublicKey, owner: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]),
  });
}

async function createTokenAccount(ctx: Ctx, mint: PublicKey, owner: PublicKey) {
  const account = Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports: rent,
      space: TOKEN_ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeAccount3(account.publicKey, mint, owner),
  );
  const sig = await ctx.provider.sendAndConfirm(tx, [ctx.payer, account]);
  return { account: account.publicKey, sig };
}

async function main() {
  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.hubMint.equals(PublicKey.default)) {
    throw new Error("Config.hub_mint unset — run devnet-hub-mint.ts first");
  }
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [vault] = vaultPda(ctx.program.programId);
  const existing = await ctx.program.account.treasuryState.fetch(treasuryState);
  if (!existing.vaultHub.equals(PublicKey.default)) {
    console.log(`treasury float already initialized · vault_hub ${existing.vaultHub.toBase58()}`);
    return;
  }

  const wsolMint = new PublicKey(WSOL_MINT);
  const { account: vaultWsol, sig: sig1 } = await createTokenAccount(ctx, wsolMint, vault);
  console.log(`vault_wsol ${vaultWsol.toBase58()} (${sig1})`);
  const { account: vaultHub, sig: sig2 } = await createTokenAccount(ctx, cfg.hubMint, vault);
  console.log(`vault_hub ${vaultHub.toBase58()} (${sig2})`);
  const { account: treasuryFloatVault, sig: sig3 } = await createTokenAccount(ctx, cfg.hubMint, vault);
  console.log(`treasury_float_vault ${treasuryFloatVault.toBase58()} (${sig3})`);

  const sig = await ctx.program.methods
    .initTreasuryFloat()
    .accountsPartial({
      treasury: ctx.payer.publicKey,
      config: ctx.config,
      treasuryState,
      vault,
      vaultWsol,
      vaultHub,
      treasuryFloatVault,
    })
    .rpc();
  console.log(`init_treasury_float :: ${sig}`);
  console.log(`  ${explorer(sig, "tx")}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
