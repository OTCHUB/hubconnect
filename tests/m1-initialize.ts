// M1 gate: initialize_config writes Appendix constants; admin paths enforce authority.
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { setup, Harness } from "./harness";
import { burnPda, configPda, potPda, treasuryPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

describe("M1 — initialize_config", () => {
  let h: Harness;
  let config: PublicKey;
  let pot: PublicKey;
  let burn: PublicKey;
  let treasuryState: PublicKey;

  // Mock OTC-side addresses (§A2: resolved from Config, never compiled in).
  const mocks = {
    opsWallet: Keypair.generate().publicKey,
    treasury: Keypair.generate().publicKey,
    otcProgram: Keypair.generate().publicKey,
    otcDeskPot: Keypair.generate().publicKey,
    deskCollection: Keypair.generate().publicKey,
    hubMint: Keypair.generate().publicKey,
    otcMint: Keypair.generate().publicKey,
  };

  before(async () => {
    h = await setup();
    [config] = configPda(h.program.programId);
    [pot] = potPda(h.program.programId);
    [burn] = burnPda(h.program.programId);
    [treasuryState] = treasuryPda(h.program.programId);
  });

  it("initializes Config/BurnState/TreasuryState with Appendix defaults", async function () {
    const existing = await h.program.account.config.fetchNullable(config);
    if (existing) {
      // Devnet re-runs: Config is a singleton; assert instead of re-init.
      expect(existing.stepFeeLamports.toNumber()).to.eq(K.STEP_FEE_LAMPORTS);
      return;
    }

    await h.program.methods
      .initializeConfig({ ...mocks })
      .accounts({ payer: h.payer.publicKey, config, pot, burn, treasuryState })
      .rpc();

    const c = await h.program.account.config.fetch(config);
    expect(c.authority.toBase58()).to.eq(h.payer.publicKey.toBase58());
    expect(c.pot.toBase58()).to.eq(pot.toBase58());
    expect(c.opsWallet.toBase58()).to.eq(mocks.opsWallet.toBase58());
    expect(c.deskCollection.toBase58()).to.eq(mocks.deskCollection.toBase58());
    expect(c.tierWeightsBp).to.deep.eq([...K.TIER_WEIGHTS_BP]);
    expect(c.stepFeeLamports.toNumber()).to.eq(K.STEP_FEE_LAMPORTS);
    expect(c.epochHours).to.eq(K.EPOCH_HOURS);
    expect(c.burnPctBp).to.eq(K.BURN_PCT_BP);
    expect(c.opsPctBp).to.eq(K.OPS_PCT_BP);
    expect(c.consignmentEnabled).to.eq(K.CONSIGNMENT_ENABLED);
    expect(c.consignorShareBp).to.eq(K.CONSIGNOR_SHARE_BP);
    expect(c.lpEnabled).to.eq(K.LP_ENABLED);
    expect(c.paused).to.eq(false);
    expect(c.currentEpoch.toNumber()).to.eq(0);

    const t = await h.program.account.treasuryState.fetch(treasuryState);
    expect(t.sweepBudgetCapBp).to.eq(K.SWEEP_BUDGET_CAP_BP);
    expect(t.sweepPaybackCapLamports.toNumber()).to.eq(K.SWEEP_PAYBACK_CAP_LAMPORTS);
    expect(t.exitDiscountBp).to.eq(K.EXIT_DISCOUNT_BP);
    expect(t.exitHubLegBp).to.eq(K.EXIT_HUB_LEG_BP);
    expect(t.floorStalenessBp).to.eq(K.FLOOR_STALENESS_BP);
    expect(t.hubFloatCapBp).to.eq(K.TREASURY_HUB_FLOAT_CAP_BP);

    const b = await h.program.account.burnState.fetch(burn);
    expect(b.burnPendingLamports.toNumber()).to.eq(0);
  });

  it("rejects a second initialize_config (singleton)", async () => {
    let failed = false;
    try {
      await h.program.methods
        .initializeConfig({ ...mocks })
        .accounts({ payer: h.payer.publicKey, config, pot, burn, treasuryState })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.eq(true);
  });

  it("pause/unpause toggles Config.paused; non-authority is rejected", async () => {
    await h.program.methods.pause().accounts({ authority: h.payer.publicKey, config }).rpc();
    expect((await h.program.account.config.fetch(config)).paused).to.eq(true);
    await h.program.methods.unpause().accounts({ authority: h.payer.publicKey, config }).rpc();
    expect((await h.program.account.config.fetch(config)).paused).to.eq(false);

    const intruder = Keypair.generate();
    let failed = false;
    try {
      await h.program.methods
        .pause()
        .accounts({ authority: intruder.publicKey, config })
        .signers([intruder])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.eq(true);
  });

  it("update_config: whitelisted bps field applies; out-of-range bps rejected", async () => {
    await h.program.methods
      .updateConfig({ burnPctBp: {} }, { u16: [1_500] })
      .accounts({ authority: h.payer.publicKey, config })
      .rpc();
    expect((await h.program.account.config.fetch(config)).burnPctBp).to.eq(1_500);

    let failed = false;
    try {
      await h.program.methods
        .updateConfig({ burnPctBp: {} }, { u16: [20_000] })
        .accounts({ authority: h.payer.publicKey, config })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.eq(true);

    await h.program.methods
      .updateConfig({ burnPctBp: {} }, { u16: [K.BURN_PCT_BP] })
      .accounts({ authority: h.payer.publicKey, config })
      .rpc();
  });
});
