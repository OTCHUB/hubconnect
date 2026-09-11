// One-time mainnet migration: repoints `TreasuryState.vault_wsol`/`vault_usdc` off the plain
// keypair accounts `mainnet-treasury-float.ts` created onto canonical Associated Token Accounts
// of the `["vault"]` PDA. Required because Jupiter's `/swap/v2/build` always derives the swap's
// *source* token account as the canonical ATA of `(taker, inputMint)` — there is no API
// parameter to override it — so `finalize_epoch`'s hop1 (SOL/USDC → $HUB via Jupiter) can never
// succeed while `vault_wsol`/`vault_usdc` are arbitrary keypair accounts. `vault_hub`/
// `treasury_float_vault` are untouched (pure Jupiter destinations, and share (owner, mint), which
// an ATA can't represent twice).
//
//   npx ts-node -T scripts/mainnet-repoint-treasury-vaults.ts [--dry-run]
//
// Preconditions:
//   - `init_treasury_float` has already run (TreasuryState.vault_wsol/vault_usdc are non-default).
//   - Both current vault_wsol/vault_usdc are drained to zero (the on-chain instruction enforces
//     this too, but this script checks first and prints a clear error rather than failing deep
//     inside a `.rpc()` call). Sweep any dust to the vault PDA's other accounts / burn it via the
//     ops wallet before running this if either is nonzero.
//
// Idempotent: no-ops (per field) if TreasuryState already points at the target canonical ATA.
import { PublicKey } from "@solana/web3.js";
import { treasuryPda, vaultPda, WSOL_MINT } from "../sdk/src";
import {
  ata,
  createAtaIdempotent,
  explorer,
  mainnetCtx,
  parseFlags,
  sendIxs,
} from "./lib/mainnet";

async function main() {
  const { has } = parseFlags(process.argv.slice(2));
  const dryRun = has("--dry-run");
  const ctx = await mainnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.usdcMint.equals(PublicKey.default)) {
    throw new Error("Config.usdc_mint unset — run mainnet-init-config.ts first");
  }

  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [vault] = vaultPda(ctx.program.programId);
  const ts = await ctx.program.account.treasuryState.fetch(treasuryState);
  if (ts.vaultWsol.equals(PublicKey.default) || ts.vaultUsdc.equals(PublicKey.default)) {
    throw new Error("TreasuryState.vault_wsol/vault_usdc unset — run mainnet-treasury-float.ts first");
  }

  const wsolMint = new PublicKey(WSOL_MINT);
  const targetVaultWsol = ata(vault, wsolMint);
  const targetVaultUsdc = ata(vault, cfg.usdcMint);

  const wsolDone = ts.vaultWsol.equals(targetVaultWsol);
  const usdcDone = ts.vaultUsdc.equals(targetVaultUsdc);
  if (wsolDone && usdcDone) {
    console.log(
      `already repointed · vault_wsol ${ts.vaultWsol.toBase58()} · vault_usdc ${ts.vaultUsdc.toBase58()}`,
    );
    return;
  }

  console.log(`vault (PDA)          ${vault.toBase58()}`);
  console.log(`old vault_wsol        ${ts.vaultWsol.toBase58()}${wsolDone ? " (already canonical ATA)" : ""}`);
  console.log(`new vault_wsol (ATA)  ${targetVaultWsol.toBase58()}`);
  console.log(`old vault_usdc        ${ts.vaultUsdc.toBase58()}${usdcDone ? " (already canonical ATA)" : ""}`);
  console.log(`new vault_usdc (ATA)  ${targetVaultUsdc.toBase58()}`);

  // Refuse to proceed if either old vault still holds a balance — the on-chain instruction
  // enforces this too, but failing here gives a clearer message before spending a tx.
  for (const [label, addr, done] of [
    ["vault_wsol", ts.vaultWsol, wsolDone] as const,
    ["vault_usdc", ts.vaultUsdc, usdcDone] as const,
  ]) {
    if (done) continue;
    const bal = await ctx.connection.getTokenAccountBalance(addr).catch(() => null);
    const amount = bal ? BigInt(bal.value.amount) : 0n;
    if (amount > 0n) {
      throw new Error(
        `${label} (${addr.toBase58()}) still holds ${bal!.value.uiAmountString} — drain it before repointing`,
      );
    }
  }

  if (dryRun) {
    console.log("dry-run: not creating ATAs or sending a transaction");
    return;
  }

  const ixs = [
    createAtaIdempotent(ctx.payer.publicKey, vault, wsolMint),
    createAtaIdempotent(ctx.payer.publicKey, vault, cfg.usdcMint),
    await ctx.program.methods
      .repointTreasuryVaults()
      .accountsPartial({
        treasury: ctx.payer.publicKey,
        config: ctx.config,
        treasuryState,
        vault,
        oldVaultWsol: ts.vaultWsol,
        oldVaultUsdc: ts.vaultUsdc,
        newVaultWsol: targetVaultWsol,
        newVaultUsdc: targetVaultUsdc,
      })
      .instruction(),
  ];
  const sig = await sendIxs(ctx, ixs);
  console.log(`repoint_treasury_vaults :: ${explorer(sig, "tx")}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
