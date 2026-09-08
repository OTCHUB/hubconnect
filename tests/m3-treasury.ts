// M3 — LP gates (§A6.2).
import { setup, Harness, ensureInitialized, Fixture, expectFail } from "./harness";
import { setConfig, bn } from "./flows";

describe("M3 — LP", () => {
  let h: Harness;
  let f: Fixture;

  before(async function () {
    this.timeout(120_000);
    h = await setup();
    f = await ensureInitialized(h);
  });

  it("build_lp: rejected while lp_enabled=false; HUB/OTC gated by phase-2; HUB/SOL needs AMM accounts", async () => {
    const call = (pair: "hubSol" | "hubOtc") =>
      h.program.methods
        .buildLp({ [pair]: {} } as never, bn(1_000), bn(1_000))
        .accountsPartial({
          treasury: f.treasury.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          lpVault: f.vault,
        })
        .signers([f.treasury])
        .rpc();
    await expectFail(call("hubSol"), "LpDisabled");
    await setConfig(h, f, "lpEnabled", { bool: [true] });
    await expectFail(call("hubOtc"), "LpPhase2Gated");
    await expectFail(call("hubSol"), "LpAccountsMissing");
    await setConfig(h, f, "lpEnabled", { bool: [false] });
  });
});
