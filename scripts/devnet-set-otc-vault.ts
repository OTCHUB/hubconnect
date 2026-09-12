// Devnet-only recovery: `OtcPotState.otc_vault`'s mint is fixed forever at `init_otc_pot` time —
// if `Config.otc_mint` is later replaced (e.g. `devnet-otc-mint.ts --force` after `init_otc_pot`
// already ran), `record_otc_buy`'s `TransferChecked` starts rejecting every deposit with SPL's
// "Account not associated with this Mint". `set_otc_vault` (admin-gated, mirrors
// `set_otc_pot_keeper`) repoints the pot at a fresh vault for the *current* otc_mint; this script
// creates that vault (owned by the `["pot"]` PDA, per `require_token_account`'s check) and calls
// it. Does not migrate any balance left in the old vault.
//   npx ts-node -T scripts/devnet-set-otc-vault.ts
import { devnetCtx, ata, createAtaIdempotent, sendIxs, explorer } from "./lib/devnet";
import { otcPotPda, potPda } from "../sdk/src";

async function main() {
  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [otcPotKey] = otcPotPda(ctx.program.programId);
  const [pot] = potPda(ctx.program.programId);
  const otcPot = await ctx.program.account.otcPotState.fetch(otcPotKey);
  console.log(`otc_pot.otc_vault (current): ${otcPot.otcVault.toBase58()}`);

  const newVault = ata(pot, cfg.otcMint);
  const createIx = createAtaIdempotent(ctx.payer.publicKey, pot, cfg.otcMint);
  const sig1 = await sendIxs(ctx, [createIx]);
  console.log(`new otc_vault ${newVault.toBase58()} (mint ${cfg.otcMint.toBase58()}, owner pot PDA) — ${explorer(sig1, "tx")}`);

  const sig2 = await ctx.program.methods
    .setOtcVault()
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      otcPot: otcPotKey,
      newOtcVault: newVault,
    })
    .rpc();
  console.log(`set_otc_vault :: ${explorer(sig2, "tx")}`);

  const updated = await ctx.program.account.otcPotState.fetch(otcPotKey);
  console.log(`otc_pot.otc_vault (new): ${updated.otcVault.toBase58()}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
