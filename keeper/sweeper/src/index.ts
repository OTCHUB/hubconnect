// §B4 — treasury desk sweeper. The acquisition decision (§A6: sweep vs mint,
// SOL-reserve-preserving, gated by `DESK_ACQUISITION_TARGET`) is implemented in
// `./arbitrage` and ready to consume.
//
// IMPORTANT — paused by default, two separate blockers:
//  1. No Magic Eden or OpenSea listing/price-feed client exists yet in this repo —
//     `decideAcquisition` needs `floorListingLamports` and `otcLamportsPerUnit` live, which
//     this cycle cannot fetch. Gated by `checkMarketplaceGate` (`../../shared/src/marketplace`),
//     which stays closed until an operator explicitly sets `SWEEPER_ENABLED=1` plus a
//     supported `MARKETPLACE_PROVIDER` + API key — deliberately OFF through mainnet launch.
//     Only the on-chain-observable half of the decision (desks_owned vs. the
//     `DESK_ACQUISITION_TARGET` ceiling) runs regardless of that gate.
//  2. Even once priced, `register_treasury_inflow` requires the transaction signer to
//     literally be `Config.treasury` (`has_one = treasury`) — the key-custody half of this is
//     resolved (see `keeper/creator-fee/src/index.ts`'s module doc), but the instruction
//     submission code itself is not implemented yet.
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { configPda, toConfigView, treasuryPda } from "../../../sdk/src";
import { loadKeeperEnv, runForever, type KeeperEnv } from "../../shared/src/env";
import { checkGasFloat } from "../../shared/src/gas";
import { checkOperationalGate } from "../../shared/src/gate";
import { appendJournal } from "../../shared/src/journal";
import {
  checkMarketplaceGate,
  loadMarketplaceGateInputsFromEnv,
} from "../../shared/src/marketplace";
import { isMintAuthoritySealed } from "../../shared/src/mint";
import { DESK_ACQUISITION_TARGET } from "./arbitrage";

const JOURNAL_DIR = path.join(__dirname, "..", "journal");

export {
  decideAcquisition,
  DESK_ACQUISITION_TARGET,
  type AcquisitionInputs,
  type AcquisitionPlan,
} from "./arbitrage";
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
export {
  checkMarketplaceGate,
  loadMarketplaceGateInputsFromEnv,
  SUPPORTED_MARKETPLACE_PROVIDERS,
  type MarketplaceProvider,
  type MarketplaceGateInputs,
  type MarketplaceGateResult,
} from "../../shared/src/marketplace";

export async function runCycle(env: KeeperEnv): Promise<void> {
  const { connection, program, keeper } = env;
  const id = program.programId;

  const ts = new Date().toISOString();
  const balance = await connection.getBalance(keeper.publicKey);
  const gas = checkGasFloat(balance);
  if (!gas.ok) {
    appendJournal(JOURNAL_DIR, { ts, service: "sweeper", status: "blocked", detail: gas.reason });
    return void console.warn(`[gate] ${gas.reason}`);
  }

  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const hubMint = new PublicKey(config.hubMint);
  const hubMintSealed = await isMintAuthoritySealed(connection, hubMint);
  const gate = checkOperationalGate({ config: { paused: config.paused }, hubMintSealed });
  if (!gate.ok) {
    appendJournal(JOURNAL_DIR, { ts, service: "sweeper", status: "blocked", detail: gate.reason });
    return void console.warn(`[gate] ${gate.reason}`);
  }

  const [treasuryKey] = treasuryPda(id);
  const tres = await program.account.treasuryState.fetch(treasuryKey);
  const meta = {
    desksOwned: tres.desksOwned,
    target: DESK_ACQUISITION_TARGET,
    totalSweeps: tres.totalSweeps,
    totalExits: tres.totalExits,
  };
  if (tres.desksOwned >= DESK_ACQUISITION_TARGET) {
    const detail = `desk acquisition target reached (${tres.desksOwned}/${DESK_ACQUISITION_TARGET} owned) — holding`;
    appendJournal(JOURNAL_DIR, { ts, service: "sweeper", status: "waited", detail, meta });
    return void console.log(`[sweeper] ${detail}`);
  }

  const marketplaceGate = checkMarketplaceGate(loadMarketplaceGateInputsFromEnv());
  if (!marketplaceGate.ok) {
    const detail = `${tres.desksOwned}/${DESK_ACQUISITION_TARGET} desks owned, ${tres.totalSweeps} lifetime sweeps, ${tres.totalExits} lifetime exits — ${marketplaceGate.reason}`;
    appendJournal(JOURNAL_DIR, { ts, service: "sweeper", status: "blocked", detail, meta });
    return void console.log(`[sweeper] ${detail}`);
  }

  const detail = `${tres.desksOwned}/${DESK_ACQUISITION_TARGET} desks owned, ${tres.totalSweeps} lifetime sweeps, ${tres.totalExits} lifetime exits — marketplace gate open (${marketplaceGate.provider}) but the listing/price client and register_treasury_inflow submission are not implemented yet [execution deferred, see module doc]`;
  appendJournal(JOURNAL_DIR, { ts, service: "sweeper", status: "blocked", detail, meta });
  console.log(`[sweeper] ${detail}`);
}

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  await runForever("sweeper keeper", env, runCycle);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
