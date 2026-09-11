// Reassigns `Config.treasury` to a dedicated hot wallet, separate from `Config.authority`
// and from any single keeper's own gas wallet (§keeper/README.md's "Auto-operate gate" note:
// `register_treasury_inflow`, `record_creator_fee`, `build_lp`, `build_lp_otc_locked`,
// `fund_treasury_reward`, `init_treasury_float`, and `set_treasury_float_cap_bp` all require
// the transaction signer to literally be `Config.treasury`, `has_one = treasury`). Signs the
// `update_config` call with the devnet deployer (= Config.authority on devnet).
//
//   npx ts-node -T scripts/devnet-set-treasury.ts [--treasury <pubkey>]
//
// `--treasury` defaults to `keeper/keys/devnet-treasury-authority.json`'s pubkey (the
// dedicated devnet hot wallet generated for this role — holds no other privilege, is not a
// keeper's `HUB_KEEPER_KEYPAIR` gas wallet, and does not itself custody any funds; the actual
// treasury balances live in the `treasury_state`/`vault` PDAs, this key only *authorizes*
// the instructions above).
import { PublicKey } from "@solana/web3.js";
import { devnetCtx, loadKeypair, setConfigPubkey } from "./lib/devnet";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  console.log(`Config.treasury (current): ${cfg.treasury.toBase58()}`);

  const treasuryArg = flag("treasury");
  const newTreasury = treasuryArg
    ? new PublicKey(treasuryArg)
    : loadKeypair("keeper/keys/devnet-treasury-authority.json").publicKey;

  const sig = await setConfigPubkey(ctx, "treasury", newTreasury);
  if (!sig) return; // already set to this value

  const updated = await ctx.program.account.config.fetch(ctx.config);
  console.log(`Config.treasury (new): ${updated.treasury.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
