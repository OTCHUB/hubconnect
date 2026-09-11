// §B4 — LP manager (depth monitor, fee harvest → source F; `build_lp` when `lp_enabled`).
//
// IMPORTANT — read-only for now: `build_lp`, `build_lp_otc_locked`, `compound_lp_otc`, and
// `compound_lp_basket` all require the transaction signer to literally be `Config.treasury`
// (`has_one = treasury`, see `programs/hub/src/instructions/treasury.rs`), not this service's
// own `HUB_KEEPER_KEYPAIR` gas wallet. This cycle only reads live state and logs what it would
// do — it never submits a transaction. See `keeper/creator-fee/src/index.ts`'s module doc for
// the same Config.treasury signer note.
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { configPda, toConfigView, treasuryPda } from "../../../sdk/src";
import { loadKeeperEnv, runForever, type KeeperEnv } from "../../shared/src/env";
import { checkGasFloat } from "../../shared/src/gas";
import { checkOperationalGate } from "../../shared/src/gate";
import { appendJournal } from "../../shared/src/journal";
import { isMintAuthoritySealed } from "../../shared/src/mint";

const JOURNAL_DIR = path.join(__dirname, "..", "journal");

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

export async function runCycle(env: KeeperEnv): Promise<void> {
  const { connection, program, keeper } = env;
  const id = program.programId;

  const ts = new Date().toISOString();
  const balance = await connection.getBalance(keeper.publicKey);
  const gas = checkGasFloat(balance);
  if (!gas.ok) {
    appendJournal(JOURNAL_DIR, { ts, service: "lp", status: "blocked", detail: gas.reason });
    return void console.warn(`[gate] ${gas.reason}`);
  }

  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const hubMint = new PublicKey(config.hubMint);
  const hubMintSealed = await isMintAuthoritySealed(connection, hubMint);
  const gate = checkOperationalGate({ config: { paused: config.paused }, hubMintSealed });
  if (!gate.ok) {
    appendJournal(JOURNAL_DIR, { ts, service: "lp", status: "blocked", detail: gate.reason });
    return void console.warn(`[gate] ${gate.reason}`);
  }

  if (!config.lpEnabled) {
    appendJournal(JOURNAL_DIR, {
      ts,
      service: "lp",
      status: "waited",
      detail: "Config.lp_enabled = false — nothing to do",
    });
    return void console.log("[lp] Config.lp_enabled = false — nothing to do");
  }

  const [treasuryKey] = treasuryPda(id);
  const tres = await program.account.treasuryState.fetch(treasuryKey);
  const lpHubDeposited = tres.lpHubDeposited.toString();
  const lpPendingHub = tres.lpPendingHubUnits.toString();
  const detail = `lp_enabled, target ${config.lpTargetSolLamports / 1e9} SOL, lp_hub_deposited ${lpHubDeposited}, lp_pending_hub ${lpPendingHub} — would evaluate build_lp/harvest_lp_fees [execution deferred: Config.treasury signer not wired, see module doc]`;
  appendJournal(JOURNAL_DIR, {
    ts,
    service: "lp",
    status: "blocked",
    detail,
    meta: { lpTargetSolLamports: config.lpTargetSolLamports, lpHubDeposited, lpPendingHub },
  });
  console.log(`[lp] ${detail}`);
}

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  await runForever("lp keeper", env, runCycle);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
