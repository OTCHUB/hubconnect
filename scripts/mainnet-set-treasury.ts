// Reassigns `Config.treasury` to a dedicated hot wallet, separate from `Config.authority` and
// from any single keeper's own gas wallet (§keeper/README.md's "Auto-operate gate" note:
// `register_treasury_inflow`, `record_creator_fee`, `build_lp`, `build_lp_otc_locked`,
// `fund_treasury_reward`, `init_treasury_float`, and `set_treasury_float_cap_bp` all require
// the transaction signer to literally be `Config.treasury`, `has_one = treasury`).
//
// Run this LAST in the mainnet init chain — after mainnet-init-tokenomics.ts,
// mainnet-treasury-float.ts, mainnet-init-hub-pot.ts, mainnet-init-creator-fee.ts — since
// `init_treasury_float` itself requires the signer to already be `Config.treasury`, and
// mainnet-init-config.ts leaves `Config.treasury` defaulted to the deployer
// (HUB_MAINNET_WALLET) precisely so those one-time calls can be signed by the same key that
// still holds Config.authority. Mirrors `devnet-set-treasury.ts`; signs the `update_config`
// call with the mainnet deployer (= Config.authority on mainnet).
//
//   npx ts-node -T scripts/mainnet-set-treasury.ts [--treasury <pubkey>]
//
// `--treasury` defaults to `keeper/keys/mainnet-treasury-authority.json`'s pubkey (the
// dedicated mainnet hot wallet generated for this role — holds no other privilege, is not a
// keeper's `HUB_KEEPER_KEYPAIR` gas wallet, and does not itself custody any funds; the actual
// treasury balances live in the `treasury_state`/`vault` PDAs, this key only *authorizes* the
// instructions above). Reassignable again later via the same flag if the real address changes.
import { PublicKey } from "@solana/web3.js";
import { loadKeypair, mainnetCtx, parseFlags, setConfigPubkey } from "./lib/mainnet";

async function main() {
  const { get } = parseFlags(process.argv.slice(2));
  const ctx = await mainnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  console.log(`Config.treasury (current): ${cfg.treasury.toBase58()}`);

  const treasuryArg = get("--treasury");
  const newTreasury = treasuryArg
    ? new PublicKey(treasuryArg)
    : loadKeypair("keeper/keys/mainnet-treasury-authority.json").publicKey;

  const sig = await setConfigPubkey(ctx, "treasury", newTreasury);
  if (!sig) return; // already set to this value

  const updated = await ctx.program.account.config.fetch(ctx.config);
  console.log(`Config.treasury (new): ${updated.treasury.toBase58()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
