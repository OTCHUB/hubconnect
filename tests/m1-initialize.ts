// M1 gate: initialize_config writes Appendix constants; admin paths enforce authority.
import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { setup, Harness, ensureInitialized, Fixture, expectFail } from "./harness";
import { epochPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

describe("M1 — initialize_config", () => {
  let h: Harness;
  let f: Fixture;

  before(async () => {
    h = await setup();
    f = await ensureInitialized(h);
  });

  it("initializes Config/BurnState/TreasuryState/Epoch0 with Appendix defaults", async () => {
    const c = await h.program.account.config.fetch(f.config);
    expect(c.authority.toBase58()).to.eq(h.payer.publicKey.toBase58());
    expect(c.pot.toBase58()).to.eq(f.pot.toBase58());
    expect(c.opsWallet.toBase58()).to.eq(f.opsWallet.toBase58());
    expect(c.deskCollection.toBase58()).to.eq(f.deskCollection.toBase58());
    expect(c.tierWeightsBp).to.deep.eq([...K.TIER_WEIGHTS_BP]);
    expect(c.stepFeeLamports.toNumber()).to.eq(K.STEP_FEE_LAMPORTS);
    expect(c.minPotThresholdLamports.toNumber()).to.eq(h.thresholdLamports);
    expect(c.accPerWeight.isZero()).to.eq(true);
    expect(c.dustScaled.isZero()).to.eq(true);
    expect(c.burnPctBp).to.eq(K.BURN_PCT_BP);
    expect(c.opsPctBp).to.eq(K.OPS_PCT_BP);
    expect(c.lpEnabled).to.eq(K.LP_ENABLED);
    expect(c.paused).to.eq(false);

    const t = await h.program.account.treasuryState.fetch(f.treasuryState);
    expect(t.vault.toBase58()).to.eq(f.vault.toBase58());
    expect(t.sweepBudgetCapBp).to.eq(K.SWEEP_BUDGET_CAP_BP);
    expect(t.sweepPaybackCapLamports.toNumber()).to.eq(K.SWEEP_PAYBACK_CAP_LAMPORTS);
    expect(t.exitDiscountBp).to.eq(K.EXIT_DISCOUNT_BP);
    expect(t.exitHubLegBp).to.eq(K.EXIT_HUB_LEG_BP);
    expect(t.floorStalenessBp).to.eq(K.FLOOR_STALENESS_BP);
    expect(t.hubFloatCapBp).to.eq(K.TREASURY_HUB_FLOAT_CAP_BP);

    const b = await h.program.account.burnState.fetch(f.burn);
    expect(b.totalHubBurned.toNumber()).to.eq(0);

    const [e0] = epochPda(h.program.programId, 0);
    const e = await h.program.account.epoch.fetch(e0);
    expect(e.index.toNumber()).to.eq(0);
    expect(e.finalized).to.eq(false);
    expect(e.finalizedTs.toNumber()).to.eq(0);

    // Pot holds at least its rent floor so it can be drained to exactly its liability.
    const rent = await h.provider.connection.getMinimumBalanceForRentExemption(0);
    expect(await h.provider.connection.getBalance(f.pot)).to.be.gte(rent);
  });

  it("rejects a second initialize_config (singleton)", async () => {
    const [epoch0] = epochPda(h.program.programId, 0);
    await expectFail(
      h.program.methods
        .initializeConfig({
          opsWallet: f.opsWallet,
          treasury: h.payer.publicKey,
          otcProgram: Keypair.generate().publicKey,
          otcDeskPot: Keypair.generate().publicKey,
          deskCollection: f.deskCollection,
          hubMint: Keypair.generate().publicKey,
          otcMint: Keypair.generate().publicKey,
          minPotThresholdLamports: new (await import("@anchor-lang/core")).BN(0),
        })
        .accountsPartial({ payer: h.payer.publicKey, ...f, epoch0 })
        .rpc(),
    );
  });

  it("pause/unpause toggles Config.paused; non-authority is rejected", async () => {
    await h.program.methods
      .pause()
      .accountsPartial({ authority: h.payer.publicKey, config: f.config })
      .rpc();
    expect((await h.program.account.config.fetch(f.config)).paused).to.eq(true);
    await h.program.methods
      .unpause()
      .accountsPartial({ authority: h.payer.publicKey, config: f.config })
      .rpc();
    expect((await h.program.account.config.fetch(f.config)).paused).to.eq(false);

    const intruder = Keypair.generate();
    await expectFail(
      h.program.methods
        .pause()
        .accountsPartial({ authority: intruder.publicKey, config: f.config })
        .signers([intruder])
        .rpc(),
    );
  });

  it("update_config: whitelisted bps field applies; out-of-range bps rejected", async () => {
    const set = (v: number) =>
      h.program.methods
        .updateConfig({ burnPctBp: {} }, { u16: [v] })
        .accountsPartial({ authority: h.payer.publicKey, config: f.config })
        .rpc();
    await set(1_500);
    expect((await h.program.account.config.fetch(f.config)).burnPctBp).to.eq(1_500);
    await expectFail(set(20_000), "BpsOutOfRange");
    await set(K.BURN_PCT_BP);
  });

  it("update_config: min_pot_threshold_lamports applies; zero rejected", async () => {
    const set = (v: number) =>
      h.program.methods
        .updateConfig({ minPotThresholdLamports: {} }, { u64: [new anchor.BN(v)] })
        .accountsPartial({ authority: h.payer.publicKey, config: f.config })
        .rpc();
    await set(LAMPORTS_PER_SOL);
    expect(
      (await h.program.account.config.fetch(f.config)).minPotThresholdLamports.toNumber(),
    ).to.eq(LAMPORTS_PER_SOL);
    await expectFail(set(0), "ZeroAmount");
    await set(h.thresholdLamports);
  });
});
