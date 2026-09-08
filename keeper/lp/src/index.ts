// §B4 — LP manager (depth monitor, fee harvest → source F). Implemented in M4.
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
  throw new Error("lp: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
