// §B4 — creator-fee flywheel keeper (§A6.3). The clear/leg-draw decision logic (does
// pending $OTC clear the threshold? how does each of the four minor legs split?) is
// implemented in `./clear_cycle` and ready to consume; the SOL gas-float gate shared
// across all keepers lives in `../../shared/src/gas`. Wiring these to a live RPC
// connection, the treasury's launcher-holder-leg claim, Jupiter swaps (OTC→HUB ×2,
// OTC→SOL), and the Raydium CP-Swap deposit+lock CPI (`build_lp_otc_locked`) lands in
// M4 — same deferral as the other three keeper services in this repo.
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

export async function main(): Promise<void> {
  throw new Error("creator-fee: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
