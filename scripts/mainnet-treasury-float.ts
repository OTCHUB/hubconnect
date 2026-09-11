// One-time mainnet provisioning for `init_treasury_float` (§A6.3/§A7.1 bridge): creates the four
// `["vault"]`-PDA-owned token accounts `finalize_epoch`'s synchronous two-hop Jupiter swap writes
// into — vault_wsol (mint = WSOL, legacy Token program), vault_usdc (mint = Config.usdc_mint,
// legacy Token program, the two-hop swap's intermediate leg), vault_hub (mint = Config.hub_mint,
// Token-2022), treasury_float_vault (mint = Config.hub_mint, Token-2022) — then calls
// `init_treasury_float` to record them on `TreasuryState`. Mirrors `devnet-treasury-float.ts`;
// the only difference is $HUB's two vaults use TOKEN_2022_PROGRAM_ID (real mainnet mint) while
// WSOL/USDC stay on the legacy Token program (both are legacy SPL on mainnet-beta).
//
// Not associated-token accounts: vault_hub and treasury_float_vault share (owner, mint), which
// an ATA can't represent twice, so all four are plain spl-token accounts at fresh keypair
// addresses (for uniformity, not just vault_hub/treasury_float_vault).
//
//   npx ts-node -T scripts/mainnet-treasury-float.ts [--dry-run]
//
// Requires: Config.hub_mint and Config.usdc_mint already real mints (both set by
// mainnet-init-config.ts) — `finalize_epoch` gates on `TreasuryState.vault_hub != default` — this
// must run before any finalize_epoch call. Idempotent: no-ops if TreasuryState.vault_hub is
// already set (no update path once created).
import { PublicKey } from "@solana/web3.js";
import { treasuryPda, vaultPda, WSOL_MINT } from "../sdk/src";
import {
  createPlainTokenAccount,
  explorer,
  mainnetCtx,
  parseFlags,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./lib/mainnet";

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.hubMint.equals(PublicKey.default)) {
    throw new Error("Config.hub_mint unset — run mainnet-init-config.ts first");
  }
  if (cfg.usdcMint.equals(PublicKey.default)) {
    throw new Error("Config.usdc_mint unset — run mainnet-init-config.ts first");
  }
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [vault] = vaultPda(ctx.program.programId);
  const existing = await ctx.program.account.treasuryState.fetch(treasuryState);
  if (!existing.vaultHub.equals(PublicKey.default)) {
    console.log(`treasury float already initialized · vault_hub ${existing.vaultHub.toBase58()}`);
    return;
  }

  console.log(
    `about to create 4 vault-PDA-owned token accounts (wsol/usdc legacy, hub/treasury-float Token-2022) ` +
      `and call init_treasury_float — vault=${vault.toBase58()}`,
  );
  if (has("--dry-run")) {
    console.log("dry-run: not creating accounts or sending a transaction");
    return;
  }

  const wsolMint = new PublicKey(WSOL_MINT);
  const { account: vaultWsol, sig: sig1 } = await createPlainTokenAccount(
    ctx,
    wsolMint,
    vault,
    TOKEN_PROGRAM_ID,
  );
  console.log(`vault_wsol ${vaultWsol.toBase58()} (${sig1})`);
  const { account: vaultUsdc, sig: sig2 } = await createPlainTokenAccount(
    ctx,
    cfg.usdcMint,
    vault,
    TOKEN_PROGRAM_ID,
  );
  console.log(`vault_usdc ${vaultUsdc.toBase58()} (${sig2})`);
  const { account: vaultHub, sig: sig3 } = await createPlainTokenAccount(
    ctx,
    cfg.hubMint,
    vault,
    TOKEN_2022_PROGRAM_ID,
  );
  console.log(`vault_hub ${vaultHub.toBase58()} (${sig3})`);
  const { account: treasuryFloatVault, sig: sig4 } = await createPlainTokenAccount(
    ctx,
    cfg.hubMint,
    vault,
    TOKEN_2022_PROGRAM_ID,
  );
  console.log(`treasury_float_vault ${treasuryFloatVault.toBase58()} (${sig4})`);

  const sig = await ctx.program.methods
    .initTreasuryFloat()
    .accountsPartial({
      treasury: ctx.payer.publicKey,
      config: ctx.config,
      treasuryState,
      vault,
      vaultWsol,
      vaultUsdc,
      vaultHub,
      treasuryFloatVault,
    })
    .rpc();
  console.log(`init_treasury_float :: ${explorer(sig, "tx")}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
