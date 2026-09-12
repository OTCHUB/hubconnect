// §A5 90% leg — off-chain OTC-buy keeper. Fronts SOL from its own hot wallet, swaps it for $OTC
// via Jupiter's EOA order+execute flow (`keeper/shared/src/eoaSwap.ts`), then calls
// `record_otc_buy` to deposit the purchase into the program-custodied `otc_vault` and be
// reimbursed up to `OtcPotState.otc_pending_lamports` — the step `claim_yield` gates on (see
// `ClaimPanel.tsx`'s "keeper hasn't recorded an $OTC buy yet" message; until this runs once,
// EVERY desk's claim reverts protocol-wide, not just the one a user happens to look at).
//
// Requires `OtcPotState.authority` to already be THIS keeper's own key (`set_otc_pot_keeper`,
// §A5 #23) — a dedicated low-privilege hot wallet, never the master admin/deployer key that
// `init_otc_pot` originally set it to.
//
// Two phases per cycle, resume-safe across a crash between them — `record_otc_buy`'s own doc
// comment: "Idempotency is the keeper's job (it checks `last_buy_tx` before resubmitting)":
//   1. swap   — SOL → $OTC, landing tokens in the keeper's own ATA. Journaled `swap-sent` with
//      the exact (otcBought, lamportsSpent) the swap moved.
//   2. record — `record_otc_buy(otcBought, lamportsSpent, buyTx)`, journaled `sent` on success.
// A cycle that finds an unmatched `swap-sent` entry (step 2 never confirmed last run) resumes
// step 2 for that exact amount instead of swapping again — it never fronts new SOL for tokens
// already sitting in its own wallet.
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { configPda, fetchOtcPot, toConfigView, WSOL_MINT } from "../../../sdk/src";
import { loadKeeperEnv, runForever, type KeeperEnv } from "../../shared/src/env";
import { checkGasFloat, KEEPER_HARD_MIN_LAMPORTS } from "../../shared/src/gas";
import { checkOperationalGate } from "../../shared/src/gate";
import { appendJournal, readJournal } from "../../shared/src/journal";
import { isMintAuthoritySealed } from "../../shared/src/mint";
import { swapExactIn } from "../../shared/src/eoaSwap";
import { findUnresolvedSwap, recordBuy, type UnresolvedSwap } from "./record";

export {
  checkGasFloat,
  KEEPER_HARD_MIN_LAMPORTS,
  KEEPER_DRIP_TRIGGER_LAMPORTS,
  KEEPER_TARGET_CEILING_LAMPORTS,
  type GasFloatCheck,
} from "../../shared/src/gas";
export {
  checkOperationalGate,
  type ConfigPauseSnapshot,
  type OperationalGateInputs,
  type OperationalGateResult,
} from "../../shared/src/gate";
export { swapExactIn, type EoaSwapConfig, type EoaSwapResult } from "../../shared/src/eoaSwap";
export { signatureToBuyTx, findUnresolvedSwap, recordBuy, type UnresolvedSwap } from "./record";

const JOURNAL_DIR = path.join(__dirname, "..", "journal");

/** Leave at least this much SOL in the keeper wallet on top of `KEEPER_HARD_MIN_LAMPORTS`'s own
 *  floor after fronting a swap, so a swap can never itself starve the next cycle's gas check. */
const RESERVE_LAMPORTS = 20_000_000; // 0.02 SOL
const DEFAULT_MAX_SWAP_LAMPORTS = 2_000_000_000; // 2 SOL per cycle, override via OTC_BUY_MAX_LAMPORTS_PER_CYCLE

/** One keeper cycle: gate checks → resume-or-swap → `record_otc_buy`. Never throws on an
 *  expected "nothing to do"/gate-refused outcome — only on unexpected RPC/swap/program errors,
 *  which the caller logs and survives so the loop keeps running. */
export async function runCycle(env: KeeperEnv): Promise<void> {
  const { connection, program, keeper } = env;
  const id = program.programId;

  const balance = await connection.getBalance(keeper.publicKey);
  const gas = checkGasFloat(balance);
  if (!gas.ok) {
    appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "blocked", detail: gas.reason });
    return void console.warn(`[gate] ${gas.reason}`);
  }

  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const hubMint = new PublicKey(config.hubMint);
  const hubMintSealed = await isMintAuthoritySealed(connection, hubMint);
  const gate = checkOperationalGate({ config: { paused: config.paused }, hubMintSealed });
  if (!gate.ok) {
    appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "blocked", detail: gate.reason });
    return void console.warn(`[gate] ${gate.reason}`);
  }

  const otcPot = await fetchOtcPot(program);
  if (!otcPot) {
    const detail = "OtcPotState not provisioned on this cluster (init_otc_pot never called) — nothing to do";
    appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "waited", detail });
    return void console.log(`[otc-buy] ${detail}`);
  }
  if (otcPot.authority !== keeper.publicKey.toBase58()) {
    const detail = `otc_pot.authority is ${otcPot.authority}, not this keeper (${keeper.publicKey.toBase58()}) — run set_otc_pot_keeper first`;
    appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "blocked", detail });
    return void console.warn(`[otc-buy] ${detail}`);
  }

  const otcMint = new PublicKey(config.otcMint);
  const otcVault = new PublicKey(otcPot.otcVault);
  let pending: UnresolvedSwap | null = findUnresolvedSwap(readJournal(JOURNAL_DIR));

  if (pending) {
    console.log(`[otc-buy] resuming an unresolved swap from a previous cycle (sig ${pending.signature}) — retrying record_otc_buy without re-swapping`);
  } else {
    if (otcPot.otcPendingLamports <= 0) {
      const detail = "otc_pending_lamports == 0 — nothing to buy this cycle";
      appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "waited", detail });
      return void console.log(`[otc-buy] ${detail}`);
    }
    const maxSwapLamports = Number(process.env.OTC_BUY_MAX_LAMPORTS_PER_CYCLE ?? DEFAULT_MAX_SWAP_LAMPORTS);
    const spendable = balance - KEEPER_HARD_MIN_LAMPORTS - RESERVE_LAMPORTS;
    const amountToSwap = Math.min(otcPot.otcPendingLamports, maxSwapLamports, spendable);
    if (amountToSwap <= 0) {
      const detail = `insufficient spare SOL to front a buy (balance ${balance}, reserve floor ${KEEPER_HARD_MIN_LAMPORTS + RESERVE_LAMPORTS})`;
      appendJournal(JOURNAL_DIR, { ts: new Date().toISOString(), service: "otc-buy", status: "blocked", detail });
      return void console.warn(`[otc-buy] ${detail}`);
    }

    const detail = `otc_pending_lamports=${otcPot.otcPendingLamports} — swapping ${amountToSwap} lamports → $OTC`;
    if (env.dryRun) {
      appendJournal(JOURNAL_DIR, {
        ts: new Date().toISOString(),
        service: "otc-buy",
        status: "dry-run",
        detail,
        meta: { amountToSwap: String(amountToSwap) },
      });
      return void console.log(`[dry-run] ${detail}`);
    }
    console.log(`[otc-buy] ${detail}`);

    try {
      const swap = await swapExactIn(keeper, WSOL_MINT, otcMint.toBase58(), BigInt(amountToSwap), {
        apiBase: process.env.JUPITER_API_BASE,
        apiKey: process.env.JUPITER_API_KEY,
        slippageBps: Number(process.env.HUB_SWAP_SLIPPAGE_BPS ?? 150),
      });
      pending = { otcBought: swap.outAmount, lamportsSpent: BigInt(amountToSwap), signature: swap.signature };
      appendJournal(JOURNAL_DIR, {
        ts: new Date().toISOString(),
        service: "otc-buy",
        status: "swap-sent",
        signature: swap.signature,
        detail: `swapped ${amountToSwap} lamports → ${swap.outAmount} $OTC-units via [${swap.router}]`,
        meta: { otcBought: pending.otcBought.toString(), lamportsSpent: pending.lamportsSpent.toString() },
      });
    } catch (e) {
      appendJournal(JOURNAL_DIR, {
        ts: new Date().toISOString(),
        service: "otc-buy",
        status: "error",
        detail: "Jupiter swap failed",
        error: String((e as Error)?.message ?? e),
      });
      throw e;
    }
  }

  try {
    const sig = await recordBuy(program, keeper, otcMint, otcVault, pending);
    appendJournal(JOURNAL_DIR, {
      ts: new Date().toISOString(),
      service: "otc-buy",
      status: "sent",
      signature: sig,
      detail: `record_otc_buy confirmed: ${pending.otcBought} $OTC-units for ${pending.lamportsSpent} lamports`,
      meta: {
        otcBought: pending.otcBought.toString(),
        lamportsSpent: pending.lamportsSpent.toString(),
        swapSignature: pending.signature,
      },
    });
    console.log(`[otc-buy] recorded → ${sig}`);
  } catch (e) {
    appendJournal(JOURNAL_DIR, {
      ts: new Date().toISOString(),
      service: "otc-buy",
      status: "confirm-error",
      detail: `record_otc_buy failed for swap ${pending.signature} — will retry next cycle without re-swapping`,
      error: String((e as Error)?.message ?? e),
      meta: {
        otcBought: pending.otcBought.toString(),
        lamportsSpent: pending.lamportsSpent.toString(),
        swapSignature: pending.signature,
      },
    });
    throw e;
  }
}

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  await runForever("otc-buy keeper", env, runCycle);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
