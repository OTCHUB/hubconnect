// §B4 — treasury desk sweeper. The acquisition decision (§A6: sweep vs mint,
// SOL-reserve-preserving, gated by `DESK_ACQUISITION_TARGET`) is implemented in
// `./arbitrage` and ready to consume; wiring it to live ME listings, an OTC/SOL price
// feed, and treasury balances lands in M4.
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

export async function main(): Promise<void> {
  throw new Error("sweeper: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
