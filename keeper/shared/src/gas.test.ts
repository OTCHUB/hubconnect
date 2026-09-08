import { expect } from "chai";
import {
  checkGasFloat,
  KEEPER_HARD_MIN_LAMPORTS,
  KEEPER_DRIP_TRIGGER_LAMPORTS,
  KEEPER_TARGET_CEILING_LAMPORTS,
} from "./gas";

describe("keeper/shared gas float", () => {
  it("refuses to start a cycle below the hard min", () => {
    const r = checkGasFloat(KEEPER_HARD_MIN_LAMPORTS - 1);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/below hard min/);
  });

  it("allows the hard min itself (boundary is inclusive)", () => {
    const r = checkGasFloat(KEEPER_HARD_MIN_LAMPORTS);
    expect(r.ok).to.equal(true);
  });

  it("requests no drip when comfortably above the trigger", () => {
    const r = checkGasFloat(KEEPER_TARGET_CEILING_LAMPORTS);
    expect(r).to.deep.equal({ ok: true, requestDripLamports: 0 });
  });

  it("requests no drip exactly at the trigger (boundary is exclusive below)", () => {
    const r = checkGasFloat(KEEPER_DRIP_TRIGGER_LAMPORTS);
    expect(r).to.deep.equal({ ok: true, requestDripLamports: 0 });
  });

  it("requests a refill-to-ceiling drip once below the trigger", () => {
    const balance = KEEPER_DRIP_TRIGGER_LAMPORTS - 1;
    const r = checkGasFloat(balance);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.requestDripLamports).to.equal(KEEPER_TARGET_CEILING_LAMPORTS - balance);
  });

  it("requests the full ceiling when starting from the hard min", () => {
    const r = checkGasFloat(KEEPER_HARD_MIN_LAMPORTS);
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.requestDripLamports).to.equal(
        KEEPER_TARGET_CEILING_LAMPORTS - KEEPER_HARD_MIN_LAMPORTS,
      );
    }
  });

  it("respects custom watermarks passed in", () => {
    const belowCustomMin = checkGasFloat(5, 10, 20, 100);
    expect(belowCustomMin.ok).to.equal(false);

    const belowCustomTrigger = checkGasFloat(15, 10, 20, 100);
    expect(belowCustomTrigger).to.deep.equal({ ok: true, requestDripLamports: 85 });
  });
});
