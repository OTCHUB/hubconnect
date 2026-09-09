// One-time devnet provisioning for the bonding-curve simulation Worker
// (web/workers/bonding-curve.ts): moves the payer's entire remaining $HUB balance — the ≥95%
// public / OTC-launch-curve supply left after devnet-init-tokenomics.ts's 5% carve-out — into
// the dedicated curve-treasury wallet's $HUB ATA, so the curve's real (non-virtual) $HUB float
// lives in its own isolated keypair, never the deployer's.
//
//   npx ts-node -T scripts/devnet-fund-curve.ts <CURVE_WALLET_PUBKEY> [--amount 950000000]
//
// Idempotent in effect (safe to re-run): only ever transfers the payer's *current* $HUB balance,
// so a second run with nothing left in the payer's ATA is a documented no-op.
import { PublicKey, Transaction } from "@solana/web3.js";
import { ata, createAtaIdempotent, devnetCtx, explorer, transferCheckedIx } from "./lib/devnet";

const HUB_DECIMALS = 6;

async function main() {
  const curveArg = process.argv[2];
  if (!curveArg) throw new Error("usage: devnet-fund-curve.ts <CURVE_WALLET_PUBKEY> [--amount N]");
  const curveWallet = new PublicKey(curveArg);

  const ctx = await devnetCtx();
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (cfg.hubMint.equals(PublicKey.default)) {
    throw new Error("Config.hub_mint unset — run devnet-hub-mint.ts first");
  }

  const payerHub = ata(ctx.payer.publicKey, cfg.hubMint);
  const bal = await ctx.connection.getTokenAccountBalance(payerHub);
  const amountFlagIdx = process.argv.indexOf("--amount");
  const amount =
    amountFlagIdx > 0
      ? BigInt(process.argv[amountFlagIdx + 1]) * 10n ** BigInt(HUB_DECIMALS)
      : BigInt(bal.value.amount);
  if (amount === 0n) {
    console.log("payer $HUB balance is 0 — nothing to fund the curve with");
    return;
  }
  if (amount > BigInt(bal.value.amount)) {
    throw new Error(`requested ${amount} exceeds payer balance ${bal.value.amount}`);
  }

  const curveHub = ata(curveWallet, cfg.hubMint);
  const tx = new Transaction().add(
    createAtaIdempotent(ctx.payer.publicKey, curveWallet, cfg.hubMint),
    transferCheckedIx(payerHub, cfg.hubMint, curveHub, ctx.payer.publicKey, amount, HUB_DECIMALS),
  );
  const sig = await ctx.provider.sendAndConfirm(tx, [ctx.payer]);
  console.log(
    `funded curve wallet ${curveWallet.toBase58()} · $HUB ATA ${curveHub.toBase58()} · ${amount} base units`,
  );
  console.log(`  ${explorer(sig, "tx")}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
