import { expect } from "chai";
import { checkOperationalGate } from "./gate";

describe("keeper/shared operational gate", () => {
  it("refuses while paused, even if the mint is sealed", () => {
    const r = checkOperationalGate({ config: { paused: true }, hubMintSealed: true });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/paused/);
  });

  it("refuses before the mint is sealed, even if unpaused", () => {
    const r = checkOperationalGate({ config: { paused: false }, hubMintSealed: false });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/mint/);
  });

  it("refuses when both conditions fail (paused wins as the first check)", () => {
    const r = checkOperationalGate({ config: { paused: true }, hubMintSealed: false });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/paused/);
  });

  it("allows once unpaused and the mint is sealed", () => {
    const r = checkOperationalGate({ config: { paused: false }, hubMintSealed: true });
    expect(r).to.deep.equal({ ok: true });
  });
});
