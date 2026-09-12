// Rotates `OtcPotState.authority` to a dedicated low-privilege `otc-buy` keeper hot wallet,
// separate from `Config.authority` (the deployer/admin key). Mirrors `mainnet-set-treasury.ts`'s
// role-rotation pattern, just calling the new `set_otc_pot_keeper` instruction
// (programs/hub/src/instructions/otc_pot.rs) instead of `update_config`.
//
// `init_otc_pot` originally set `otc_pot.authority` to the mainnet deployer key so the one-time
// setup call could be signed by the same key that held `Config.authority` at the time; this
// script moves it onto its own dedicated key going forward so a leak of the (much higher-value)
// deployer key isn't required just to run the recurring `record_otc_buy` cycle, and vice versa —
// consistent with `Config.treasury`'s isolation from `Config.authority`.
//
//   npx ts-node -T scripts/mainnet-set-otc-pot-keeper.ts [--keeper <pubkey>]
//
// `--keeper` defaults to `keeper/keys/mainnet-otc-buy-keeper.json`'s pubkey. Signs with
// `HUB_MAINNET_WALLET` (must currently be `Config.authority` — admin-gated, `has_one = authority`
// on `SetOtcPotKeeper`).
import { PublicKey } from "@solana/web3.js";
import { loadKeypair, mainnetCtx } from "./lib/mainnet";
import { otcPotPda } from "../sdk/src/pda";

function parseFlags(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { get };
}

async function main() {
  const { get } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();
  const [otcPot] = otcPotPda(ctx.program.programId);

  const pot = await ctx.program.account.otcPotState.fetch(otcPot);
  console.log(`otc_pot.authority (current): ${pot.authority.toBase58()}`);

  const keeperArg = get("--keeper");
  const newKeeper = keeperArg
    ? new PublicKey(keeperArg)
    : loadKeypair("keeper/keys/mainnet-otc-buy-keeper.json").publicKey;

  if (pot.authority.equals(newKeeper)) {
    console.log(`otc_pot.authority already ${newKeeper.toBase58()}`);
    return;
  }

  const sig = await ctx.program.methods
    .setOtcPotKeeper(newKeeper)
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config, otcPot })
    .rpc();
  console.log(`otc_pot.authority → ${newKeeper.toBase58()}  (${sig})`);

  const updated = await ctx.program.account.otcPotState.fetch(otcPot);
  console.log(`otc_pot.authority (new): ${updated.authority.toBase58()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
