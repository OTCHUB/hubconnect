import { expect } from "chai";
import { decideAcquisition, DESK_ACQUISITION_TARGET, type AcquisitionInputs } from "./arbitrage";

const base: AcquisitionInputs = {
  floorListingLamports: 6_000_000_000, // 6 SOL list price
  otcLamportsPerUnit: 50, // arbitrary $OTC/SOL rate for the mint-cost comparison
  treasurySolLamports: 100_000_000_000, // 100 SOL free
  treasuryOtcUnits: 0n,
  solReserveFloorLamports: 10_000_000_000, // 10 SOL reserve floor
  desksOwned: 0,
};

describe("keeper/sweeper decideAcquisition — desk acquisition target", () => {
  it("sweeps normally while below the default target", () => {
    const plan = decideAcquisition({ ...base, desksOwned: DESK_ACQUISITION_TARGET - 1 });
    expect(plan.action).to.not.equal("hold");
  });

  it("holds once desksOwned reaches the default target, even with a great spread", () => {
    const plan = decideAcquisition({ ...base, desksOwned: DESK_ACQUISITION_TARGET });
    expect(plan).to.deep.equal({
      action: "hold",
      reason: `desk acquisition target reached (${DESK_ACQUISITION_TARGET}/${DESK_ACQUISITION_TARGET} owned) — raise deskTarget via config to resume sweeping/minting`,
    });
  });

  it("holds above the default target too", () => {
    const plan = decideAcquisition({ ...base, desksOwned: DESK_ACQUISITION_TARGET + 5 });
    expect(plan.action).to.equal("hold");
  });

  it("respects a custom deskTarget override", () => {
    const stillBelowCustom = decideAcquisition({ ...base, desksOwned: 25, deskTarget: 30 });
    expect(stillBelowCustom.action).to.not.equal("hold");

    const atCustom = decideAcquisition({ ...base, desksOwned: 30, deskTarget: 30 });
    expect(atCustom.action).to.equal("hold");
  });

  it("desk-target gate takes priority over an otherwise-viable sweep", () => {
    // Deliberately favorable spread (cheap floor, plenty of free SOL) — should still hold.
    const plan = decideAcquisition({
      ...base,
      floorListingLamports: 1_000_000_000,
      desksOwned: DESK_ACQUISITION_TARGET,
    });
    expect(plan.action).to.equal("hold");
  });

  it("falls back to sweep/mint/hold economics once under target (sanity check)", () => {
    const plan = decideAcquisition({ ...base, desksOwned: 0 });
    expect(plan.action).to.equal("sweep");
  });
});
