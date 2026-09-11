// §B4 — creator-fee flywheel keeper (§A6.3). The clear/leg-draw decision logic (does
// pending $OTC clear the threshold? how does each of the four minor legs split?) is
// implemented in `./clear_cycle` and wired below to live on-chain reads every cycle.
//
// IMPORTANT — read-only for now: `record_creator_fee`, `clear_creator_fees`, and
// `draw_creator_fee_leg` all require the transaction signer to literally be
// `Config.treasury` (`has_one = treasury`, see `programs/hub/src/instructions/creator_fee.rs`),
// not this service's own `HUB_KEEPER_KEYPAIR` gas wallet. Until the operator either (a)
// reassigns `Config.treasury` to a dedicated hot wallet via `update_config` or (b) decides
// these stay manually co-signed, this cycle only computes and logs the decision — it never
// submits a transaction. The `SwapLeg` execution (OTC→HUB/OTC→SOL via Jupiter,
// `build_lp_otc_locked` for the LP leg) is also not wired yet; `../../shared/src/eoaSwap`
// is ready to consume once a signer is assigned.
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { configPda, fetchCreatorFee, toConfigView } from "../../../sdk/src";
import { loadKeeperEnv, runForever, type KeeperEnv } from "../../shared/src/env";
import { checkGasFloat } from "../../shared/src/gas";
import { checkOperationalGate } from "../../shared/src/gate";
import { appendJournal } from "../../shared/src/journal";
import { isMintAuthoritySealed } from "../../shared/src/mint";
import { planClear, planLegDraws, isLpLeg } from "./clear_cycle";

const JOURNAL_DIR = path.join(__dirname, "..", "journal");

export {
  planClear,
  planSimpleLeg,
  planLpLeg,
  planLegDraws,
  isLpLeg,
  type SwapLeg,
  type CreatorFeeStateSnapshot,
  type ClearDecision,
  type SimpleLegPlan,
  type LpLegPlan,
  type LegPlan,
} from "./clear_cycle";
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
      service: "creator-fee",
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
      service: "creator-fee",
      status: "blocked",
      detail: gate.reason,
    });
    return void console.warn(`[gate] ${gate.reason}`);
  }

  const state = await fetchCreatorFee(program);
  if (!state) {
    const detail =
      "CreatorFeeState not provisioned on this cluster (init_creator_fee_state never called) — nothing to do";
    appendJournal(JOURNAL_DIR, { ts, service: "creator-fee", status: "waited", detail });
    return void console.log(`[creator-fee] ${detail}`);
  }

  const snapshot = {
    pendingOtcUnits: state.pendingOtcUnits,
    clearThresholdUnits: state.clearThresholdUnits,
    burnPendingOtc: state.burnPendingOtc,
    lpPendingOtc: state.lpPendingOtc,
    stackPendingOtc: state.stackPendingOtc,
    opsPendingOtc: state.opsPendingOtc,
  };
  const snapshotMeta = {
    pendingOtcUnits: snapshot.pendingOtcUnits.toString(),
    clearThresholdUnits: snapshot.clearThresholdUnits.toString(),
    burnPendingOtc: snapshot.burnPendingOtc.toString(),
    lpPendingOtc: snapshot.lpPendingOtc.toString(),
    stackPendingOtc: snapshot.stackPendingOtc.toString(),
    opsPendingOtc: snapshot.opsPendingOtc.toString(),
  };

  const clear = planClear(snapshot);
  if (clear.action === "wait") {
    appendJournal(JOURNAL_DIR, {
      ts,
      service: "creator-fee",
      status: "waited",
      detail: clear.reason,
      meta: snapshotMeta,
    });
    return void console.log(`[creator-fee] ${clear.reason}`);
  }
  const clearDetail = `threshold cleared (${snapshot.pendingOtcUnits} ≥ ${snapshot.clearThresholdUnits} $OTC-units) — would call clear_creator_fees [execution deferred: Config.treasury signer not wired, see module doc]`;
  console.log(`[creator-fee] ${clearDetail}`);

  const legs = planLegDraws(snapshot);
  const legSummaries = legs.map((leg) =>
    isLpLeg(leg)
      ? `LP leg: ${leg.otcToDraw} $OTC-units (${leg.otcToSwapForHub} → swap to $HUB, ${leg.otcToDepositRaw} → raw deposit)`
      : `${leg.leg} leg: ${leg.otcToDraw} $OTC-units`,
  );
  for (const summary of legSummaries) {
    console.log(`[creator-fee]   would draw ${summary} [execution deferred]`);
  }
  appendJournal(JOURNAL_DIR, {
    ts,
    service: "creator-fee",
    status: "blocked",
    detail: clearDetail,
    meta: { ...snapshotMeta, legs: legSummaries },
  });
}

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  await runForever("creator-fee keeper", env, runCycle);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
