// Fresh `initialize_config` on devnet. Config/Epoch/TreasuryState/BurnState are singleton PDAs
// created with Anchor's `init` constraint, so once a breaking layout change lands (e.g. this
// refactor's `treasury_float_pct_bp` field) the live devnet account is the wrong size and every
// call fails to deserialize — there is no in-place migration path for `init`-only accounts.
//   npx ts-node -T scripts/devnet-init-config.ts --reset [--min-pot-threshold 100000000]
//
// --reset closes the four `init`-created PDAs via the devnet-only `devnet_reset` instruction
// (see programs/hub/src/instructions/admin.rs, gated behind the `mock-jupiter` Cargo feature —
// never present in a mainnet build) so `initialize_config` can re-`init` the same addresses.
// Without --reset this only runs `initialize_config` on a cluster where Config has never existed.
//
// hub_mint/otc_mint/usdc_mint/desk_collection are left at their zero default here — run (in
// order) devnet-hub-mint.ts, devnet-otc-mint.ts, mock-jupiter-setup.ts (also creates a devnet
// mock USDC mint and points Config.usdc_mint at it — see its doc comment), devnet-mock-desks.ts
// afterwards to reprovision them, then scripts/devnet-treasury-float.ts before any
// finalize_epoch call.
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { burnPda, epochPda, potPda, treasuryPda, vaultPda } from "../sdk/src";
import { devnetCtx, explorer, type Ctx } from "./lib/devnet";

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/**
 * `authority` is `Config`'s first field (offset 8, right after the 8-byte discriminator) in
 * every layout version, so it can always be read directly off the raw account — unlike a typed
 * Anchor fetch, which throws mid-deserialize the moment any *later* field's layout has drifted
 * (exactly the "Invalid bool: N" this script exists to get past).
 */
function readAuthority(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(8, 40));
}

async function resetIfPresent(ctx: Ctx) {
  const info = await ctx.connection.getAccountInfo(ctx.config);
  if (!info) {
    console.log("Config does not exist yet — nothing to reset");
    return;
  }
  const authority = readAuthority(info.data);
  if (!authority.equals(ctx.payer.publicKey)) {
    throw new Error(`payer is not Config.authority (${authority.toBase58()}) — cannot reset`);
  }
  // Never successfully reached finalize_epoch on this layout (that's the whole reason for the
  // reset), so the open epoch is always #0 — avoids depending on a typed decode of a stale
  // account for `current_epoch`'s field offset, which shifts across layout versions.
  const epochIndex = new BN(0);
  const [burn] = burnPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [epoch] = epochPda(ctx.program.programId, epochIndex);
  const sig = await ctx.program.methods
    .devnetReset(epochIndex)
    .accountsPartial({
      authority: ctx.payer.publicKey,
      config: ctx.config,
      burn,
      treasuryState,
      epoch,
    })
    .rpc();
  console.log(`devnet_reset :: closed config/burn/treasury_state/epoch#${epochIndex} (${sig})`);
}

async function main() {
  const ctx = await devnetCtx();
  const doReset = process.argv.includes("--reset");
  const minPotThresholdLamports = Number(arg("--min-pot-threshold", "0"));

  if (doReset) await resetIfPresent(ctx);

  const already = await ctx.connection.getAccountInfo(ctx.config);
  if (already) {
    console.log(`Config already initialized (authority ${readAuthority(already.data).toBase58()})`);
    console.log(`  ${explorer(ctx.config.toBase58())}`);
    return;
  }

  const id = ctx.program.programId;
  const [pot] = potPda(id);
  const [burn] = burnPda(id);
  const [treasuryState] = treasuryPda(id);
  const [vault] = vaultPda(id);
  const [epoch0] = epochPda(id, 0);

  const sig = await ctx.program.methods
    .initializeConfig({
      opsWallet: ctx.payer.publicKey,
      treasury: ctx.payer.publicKey,
      otcProgram: Keypair.generate().publicKey,
      otcDeskPot: Keypair.generate().publicKey,
      deskCollection: PublicKey.default,
      hubMint: PublicKey.default,
      otcMint: PublicKey.default,
      usdcMint: PublicKey.default,
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
  console.log(`initialize_config :: authority/ops/treasury = ${ctx.payer.publicKey.toBase58()}`);
  console.log(`  ${explorer(sig, "tx")}`);
  console.log(`config = ${ctx.config.toBase58()}  ${explorer(ctx.config.toBase58())}`);
  console.log(
    "next: devnet-hub-mint.ts, devnet-otc-mint.ts, mock-jupiter-setup.ts, devnet-mock-desks.ts, devnet-treasury-float.ts",
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
