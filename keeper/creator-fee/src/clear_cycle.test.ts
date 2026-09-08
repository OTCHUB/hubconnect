import { expect } from "chai";
import {
  planClear,
  planSimpleLeg,
  planLpLeg,
  planLegDraws,
  isLpLeg,
  type CreatorFeeStateSnapshot,
} from "./clear_cycle";

const emptyState: CreatorFeeStateSnapshot = {
  pendingOtcUnits: 0n,
  clearThresholdUnits: 1_000_000_000n, // 1,000 $OTC @ 6 decimals
  burnPendingOtc: 0n,
  lpPendingOtc: 0n,
  stackPendingOtc: 0n,
  opsPendingOtc: 0n,
};

describe("keeper/creator-fee clear_cycle", () => {
  describe("planClear", () => {
    it("waits below threshold", () => {
      const d = planClear({ ...emptyState, pendingOtcUnits: 999_999_999n });
      expect(d.action).to.equal("wait");
    });

    it("clears exactly at threshold", () => {
      const d = planClear({ ...emptyState, pendingOtcUnits: 1_000_000_000n });
      expect(d).to.deep.equal({ action: "clear" });
    });

    it("clears above threshold", () => {
      const d = planClear({ ...emptyState, pendingOtcUnits: 5_000_000_000n });
      expect(d).to.deep.equal({ action: "clear" });
    });
  });

  describe("planSimpleLeg", () => {
    it("returns null when nothing pending", () => {
      expect(planSimpleLeg("burn", 0n)).to.equal(null);
    });

    it("draws the full pending balance", () => {
      expect(planSimpleLeg("ops", 50_000_000n)).to.deep.equal({
        leg: "ops",
        otcToDraw: 50_000_000n,
      });
    });
  });

  describe("planLpLeg", () => {
    it("returns null when nothing pending", () => {
      expect(planLpLeg(0n)).to.equal(null);
    });

    it("splits evenly 50/50 on an even amount", () => {
      const p = planLpLeg(50_000_000n);
      expect(p).to.deep.equal({
        leg: "lp",
        otcToDraw: 50_000_000n,
        otcToSwapForHub: 25_000_000n,
        otcToDepositRaw: 25_000_000n,
      });
    });

    it("gives the odd unit to the raw-deposit half and never loses a unit", () => {
      const p = planLpLeg(50_000_001n);
      expect(p).to.not.equal(null);
      expect(p!.otcToSwapForHub + p!.otcToDepositRaw).to.equal(p!.otcToDraw);
      expect(p!.otcToSwapForHub).to.equal(25_000_000n);
      expect(p!.otcToDepositRaw).to.equal(25_000_001n);
    });
  });

  describe("planLegDraws", () => {
    it("returns nothing when all legs are empty", () => {
      expect(planLegDraws(emptyState)).to.deep.equal([]);
    });

    it("returns only legs with a nonzero pending balance, in burn/lp/stack/ops order", () => {
      const state: CreatorFeeStateSnapshot = {
        ...emptyState,
        burnPendingOtc: 10n,
        lpPendingOtc: 0n,
        stackPendingOtc: 20n,
        opsPendingOtc: 30n,
      };
      const plans = planLegDraws(state);
      expect(plans.map((p) => p.leg)).to.deep.equal(["burn", "stack", "ops"]);
    });

    it("includes the LP leg with its 50/50 split when present", () => {
      const state: CreatorFeeStateSnapshot = {
        ...emptyState,
        burnPendingOtc: 10n,
        lpPendingOtc: 100n,
        stackPendingOtc: 10n,
        opsPendingOtc: 10n,
      };
      const plans = planLegDraws(state);
      const lp = plans.find(isLpLeg);
      expect(lp).to.not.equal(undefined);
      expect(lp!.otcToSwapForHub).to.equal(50n);
      expect(lp!.otcToDepositRaw).to.equal(50n);
    });

    it("all four legs at once preserves fixed ordering", () => {
      const state: CreatorFeeStateSnapshot = {
        ...emptyState,
        burnPendingOtc: 1n,
        lpPendingOtc: 1n,
        stackPendingOtc: 1n,
        opsPendingOtc: 1n,
      };
      expect(planLegDraws(state).map((p) => p.leg)).to.deep.equal(["burn", "lp", "stack", "ops"]);
    });
  });
});
