// §B4 — treasury exit service (90% floor; HUB leg burned / SOL leg → pot; 5%
// `FLOOR_STALENESS_GUARD`, per `keeper/README.md`).
//
// BLOCKED — no on-chain instruction for this exists yet. `programs/hub/src/instructions/
// treasury.rs` has `build_lp`/`build_lp_otc_locked`/`compound_lp_*`/`harvest_lp_fees`/
// `init_treasury_float`/`set_treasury_float_cap_bp` only; there is no `treasury_exit` (or
// equivalently named) instruction, and no `floor_staleness`/`FLOOR_STALENESS_GUARD` field
// anywhere in the program. This service cannot move funds — or even compute a real
// decision — until that instruction is designed, implemented, audited, and deployed. This
// cycle just confirms the gate/gas plumbing wires up correctly and idles.
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { configPda, toConfigView } from "../../../sdk/src";
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
    appendJournal(JOURNAL_DIR, {
      ts,
      service: "treasury-exit",
      status: "blocked",
      detail: gas.reason,
    });
    return void console.warn(`[gate] ${gas.reason}`);
  }

  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const hubMint = new PublicKey(config.hubMint);
  const hubMintSealed = await isMintAuthoritySealed(connection, hubMint);
  const gate = checkOperationalGate({ config: { paused: config.paused }, hubMintSealed });
  if (!gate.ok) {
    appendJournal(JOURNAL_DIR, {
      ts,
      service: "treasury-exit",
      status: "blocked",
      detail: gate.reason,
    });
    return void console.warn(`[gate] ${gate.reason}`);
  }

  const detail =
    "gate/gas OK, but no on-chain treasury-exit instruction exists yet — idling (see module doc)";
  appendJournal(JOURNAL_DIR, { ts, service: "treasury-exit", status: "blocked", detail });
  console.log(`[treasury-exit] ${detail}`);
}

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  await runForever("treasury-exit keeper", env, runCycle);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
