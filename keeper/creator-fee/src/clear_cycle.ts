// §A6.3 — creator-fee flywheel keeper: pure decision/orchestration logic only, no
// RPC/signing. One cycle: deposit the treasury's claimed launcher holder-leg $OTC
// (`record_creator_fee`), clear it 80/5/5/5/5 once threshold is hit
// (`clear_creator_fees`), then for each of the four minor legs draw + off-chain-swap +
// attest. Mirrors `sweeper/src/arbitrage.ts`'s "pure logic, no RPC/API calls, no
// signing" pattern; the M4 `index.ts` service wires this to live Jupiter/Raydium/RPC
// calls and the on-chain instructions themselves.

/** Leg names matching the program's `CreatorFeeLeg` enum (`DeskPot` excluded — it's
 *  injected directly by `clear_creator_fees`, no swap needed). */
export type SwapLeg = "burn" | "lp" | "stack" | "ops";

export type CreatorFeeStateSnapshot = {
  pendingOtcUnits: bigint;
  clearThresholdUnits: bigint;
  burnPendingOtc: bigint;
  lpPendingOtc: bigint;
  stackPendingOtc: bigint;
  opsPendingOtc: bigint;
};

export type ClearDecision = { action: "clear" } | { action: "wait"; reason: string };

/** Whether `clear_creator_fees` should be called this cycle — permissionless, purely
 *  a threshold check, mirroring the on-chain `CreatorFeeBelowThreshold` guard. */
export function planClear(state: CreatorFeeStateSnapshot): ClearDecision {
  if (state.pendingOtcUnits >= state.clearThresholdUnits) return { action: "clear" };
  return {
    action: "wait",
    reason: `pending ${state.pendingOtcUnits} $OTC-units below threshold ${state.clearThresholdUnits}`,
  };
}

export type SimpleLegPlan = { leg: "burn" | "stack" | "ops"; otcToDraw: bigint };

/** Burn/Stack/Ops legs are a single 100%-of-pending swap (OTC→HUB, OTC→HUB, OTC→SOL
 *  respectively) — nothing to split. Returns null once the leg's pending balance is
 *  fully drawn down (nothing left to do this cycle). */
export function planSimpleLeg(
  leg: "burn" | "stack" | "ops",
  pendingOtcUnits: bigint,
): SimpleLegPlan | null {
  if (pendingOtcUnits <= 0n) return null;
  return { leg, otcToDraw: pendingOtcUnits };
}

export type LpLegPlan = {
  leg: "lp";
  otcToDraw: bigint;
  /** Half of the leg, routed OTC→HUB via Jupiter before the pool deposit. */
  otcToSwapForHub: bigint;
  /** The other half, deposited into the pool unswapped (per the confirmed design:
   *  "50% of the OTC earn swap to $HUB the other half inject and add lp"). */
  otcToDepositRaw: bigint;
};

/** LP leg splits its pending $OTC 50/50. Odd-unit remainders go to the raw-deposit
 *  half so `otcToSwapForHub + otcToDepositRaw` always equals `otcToDraw` exactly —
 *  same floor-division-with-remainder-absorption pattern as `clear_creator_fees`'s
 *  desk-pot leg. */
export function planLpLeg(pendingOtcUnits: bigint): LpLegPlan | null {
  if (pendingOtcUnits <= 0n) return null;
  const otcToSwapForHub = pendingOtcUnits / 2n;
  const otcToDepositRaw = pendingOtcUnits - otcToSwapForHub;
  return { leg: "lp", otcToDraw: pendingOtcUnits, otcToSwapForHub, otcToDepositRaw };
}

export type LegPlan = SimpleLegPlan | LpLegPlan;

/** All leg plans for the current cycle, in a fixed order (burn, lp, stack, ops),
 *  skipping any leg with nothing pending. Each entry maps 1:1 to one
 *  `draw_creator_fee_leg` call plus its off-chain swap(s) and attestation. */
export function planLegDraws(state: CreatorFeeStateSnapshot): LegPlan[] {
  const plans: (LegPlan | null)[] = [
    planSimpleLeg("burn", state.burnPendingOtc),
    planLpLeg(state.lpPendingOtc),
    planSimpleLeg("stack", state.stackPendingOtc),
    planSimpleLeg("ops", state.opsPendingOtc),
  ];
  return plans.filter((p): p is LegPlan => p !== null);
}

/** True if a leg plan is the LP leg (narrows `LegPlan` to `LpLegPlan`). */
export function isLpLeg(plan: LegPlan): plan is LpLegPlan {
  return plan.leg === "lp";
}
