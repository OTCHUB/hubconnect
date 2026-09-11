// One-time: creates + extends the Address Lookup Table `finalize_epoch`'s mainnet keeper uses to
// fit its synchronous two-hop swap CPI (Jupiter hop1 + direct Raydium CP-Swap hop2) under the
// legacy 1232-byte transaction limit. Root cause of the "Transaction too large" crash loop on
// `hub-keeper-epoch-mainnet`: `finalize_epoch`'s own ~18 fixed accounts + hop2's 13 fixed Raydium
// accounts + hop1's Jupiter route accounts, all as static (non-ALT) keys, overflow 1232 bytes even
// at the tightest still-routable `maxAccounts` (empirically confirmed via a size probe against
// live mainnet state — every route came back 1360-2040+ bytes).
//
// This table holds only accounts that are IMMUTABLE for the table's lifetime — never `epoch`/
// `nextEpoch` (their PDA changes every cycle) and never anything Jupiter's hop1 route touches
// (Jupiter's own docs: CPI-invoked swap instructions cannot resolve accounts via ALT — see
// https://dev.jup.ag/docs/swap/build/common-instructions#cpi-cross-program-invocation). Hop2 is
// OUR OWN direct Raydium CPI (not routed through Jupiter), so its fixed pool accounts are exactly
// as ALT-safe as `finalize_epoch`'s own static accounts.
//
//   npx ts-node -T scripts/mainnet-create-epoch-alt.ts
//
// Prints the resulting ALT address — wire it into `keeper/ecosystem.mainnet.config.js` as
// `HUB_EPOCH_ALT` on the `hub-keeper-epoch-mainnet` app only, then `pm2 restart
// hub-keeper-epoch-mainnet --update-env`.
import { AddressLookupTableProgram, PublicKey, Transaction } from "@solana/web3.js";
import {
  HUB_USDC_POOL,
  JUPITER_PROGRAM_ID,
  RAYDIUM_CP_SWAP_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  burnPda,
  otcPotPda,
  potPda,
  treasuryPda,
  vaultPda,
} from "../sdk/src";
import { mainnetCtx, sleep } from "./lib/mainnet";

async function main() {
  const ctx = await mainnetCtx();
  const id = ctx.program.programId;
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [treasuryKey] = treasuryPda(id);
  const treasury = await ctx.program.account.treasuryState.fetch(treasuryKey);
  const [vaultKey] = vaultPda(id);
  const [potKey] = potPda(id);
  const [burnKey] = burnPda(id);
  const [otcPotKey] = otcPotPda(id);

  const addresses = Array.from(
    new Set(
      [
        ctx.config,
        potKey,
        burnKey,
        otcPotKey,
        treasuryKey,
        vaultKey,
        cfg.hubMint,
        treasury.vaultWsol,
        treasury.vaultUsdc,
        treasury.vaultHub,
        treasury.treasuryFloatVault,
        new PublicKey(TOKEN_PROGRAM_ID),
        new PublicKey(JUPITER_PROGRAM_ID),
        new PublicKey(RAYDIUM_CP_SWAP_PROGRAM_ID),
        new PublicKey(HUB_USDC_POOL.authority),
        new PublicKey(HUB_USDC_POOL.ammConfig),
        new PublicKey(HUB_USDC_POOL.poolState),
        new PublicKey(HUB_USDC_POOL.usdcVault),
        new PublicKey(HUB_USDC_POOL.hubVault),
        new PublicKey(HUB_USDC_POOL.observationState),
        new PublicKey(TOKEN_2022_PROGRAM_ID),
        new PublicKey(USDC_MINT),
      ].map((k) => k.toBase58()),
    ),
  ).map((s) => new PublicKey(s));

  console.log(`assembling ALT with ${addresses.length} unique static accounts`);

  const slot = await ctx.connection.getSlot("finalized");
  const [createIx, altKey] = AddressLookupTableProgram.createLookupTable({
    authority: ctx.payer.publicKey,
    payer: ctx.payer.publicKey,
    recentSlot: slot,
  });
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: ctx.payer.publicKey,
    authority: ctx.payer.publicKey,
    lookupTable: altKey,
    addresses,
  });

  const sig = await ctx.provider.sendAndConfirm(
    new Transaction().add(createIx, extendIx),
    [ctx.payer],
  );
  console.log(`created + extended ALT ${altKey.toBase58()}  (${sig})`);

  // ALTs only become usable for lookups one slot after they warm up — a short poll avoids racing
  // an immediate keeper restart into "table not yet active" simulation failures.
  await sleep(3000);
  const info = await ctx.connection.getAddressLookupTable(altKey);
  console.log(`readback: ${info.value?.state.addresses.length ?? 0} addresses active`);
  console.log(`\nSet HUB_EPOCH_ALT=${altKey.toBase58()} on hub-keeper-epoch-mainnet.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
