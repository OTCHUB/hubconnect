// M3 — consignment (§A6.1), consignor share split, LP gates (§A6.2).
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  setup,
  Harness,
  ensureInitialized,
  Fixture,
  fundWallet,
  createDeskAsset,
  coreOwner,
  expectFail,
} from "./harness";
import {
  consign,
  unconsign,
  consignedInflow,
  finalizeCurrent,
  setConfig,
  assertSolvent,
  balance,
  bn,
  currentEpoch,
} from "./flows";
import { consignPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

describe("M3 — consignment & LP", () => {
  let h: Harness;
  let f: Fixture;
  let owner: Keypair;
  let desk: PublicKey;

  before(async function () {
    this.timeout(120_000);
    h = await setup();
    f = await ensureInitialized(h);
    owner = await fundWallet(h, 0.5 * LAMPORTS_PER_SOL);
    desk = await createDeskAsset(h, f.deskCollection, owner.publicKey);
  });

  it("consign moves the Core asset into the program vault and records the consignor", async () => {
    const ts0 = (await h.program.account.treasuryState.fetch(f.treasuryState)).desksConsigned;
    await consign(h, f, owner, desk);
    expect((await coreOwner(h, desk)).toBase58()).to.eq(f.vault.toBase58());
    const cd = await h.program.account.consignedDesk.fetch(
      consignPda(h.program.programId, desk)[0],
    );
    expect(cd.active).to.eq(true);
    expect(cd.consignor.toBase58()).to.eq(owner.publicKey.toBase58());
    expect((await h.program.account.treasuryState.fetch(f.treasuryState)).desksConsigned).to.eq(
      ts0 + 1,
    );
    await expectFail(consign(h, f, owner, desk), "NotDeskOwner"); // owner no longer holds it
  });

  it("unconsign before the consignment epoch finalizes is rejected", async () => {
    await expectFail(unconsign(h, f, owner, desk), "UnconsignBeforeFinalize");
  });

  it("source E at 0% share: everything goes to the pool; at 50%: consignor accrual credited and claimable", async () => {
    const { epoch: eBefore } = await currentEpoch(h, f);
    const in0 = eBefore.inflowLamports.toNumber();
    await consignedInflow(h, f, desk, owner.publicKey, 100_000_000);
    const { epoch: eAfter } = await currentEpoch(h, f);
    expect(eAfter.inflowLamports.toNumber() - in0).to.eq(100_000_000);

    await setConfig(h, f, "consignorShareBp", { u16: [5_000] });
    const { epochIdx, consignorAccrual } = await consignedInflow(
      h,
      f,
      desk,
      owner.publicKey,
      100_000_000,
    );
    const a = await h.program.account.stakerAccrual.fetch(consignorAccrual);
    expect(a.owedLamports.toNumber()).to.eq(50_000_000);
    const { epoch: eAfter2 } = await currentEpoch(h, f);
    expect(eAfter2.inflowLamports.toNumber() - eAfter.inflowLamports.toNumber()).to.eq(50_000_000);
    await assertSolvent(h, f);

    const b0 = await balance(h, owner.publicKey);
    await h.program.methods
      .claimAccrual(bn(epochIdx))
      .accountsPartial({
        wallet: owner.publicKey,
        config: f.config,
        accrual: consignorAccrual,
        pot: f.pot,
      })
      .signers([owner])
      .rpc();
    expect((await balance(h, owner.publicKey)) - b0).to.eq(50_000_000); // provider wallet pays the fee
    await expectFail(
      h.program.methods
        .claimAccrual(bn(epochIdx))
        .accountsPartial({
          wallet: owner.publicKey,
          config: f.config,
          accrual: consignorAccrual,
          pot: f.pot,
        })
        .signers([owner])
        .rpc(),
      "AccrualEmpty",
    );
    await setConfig(h, f, "consignorShareBp", { u16: [K.CONSIGNOR_SHARE_BP] });
  });

  it("consigned-desk inflow is rejected for a non-treasury signer and for an inactive record", async () => {
    const stranger = await fundWallet(h, 0.2 * LAMPORTS_PER_SOL);
    const other = await createDeskAsset(h, f.deskCollection, stranger.publicKey);
    await expectFail(consignedInflow(h, f, other, stranger.publicKey, 1_000)); // no ConsignedDesk account
    const { key: epoch, idx } = await currentEpoch(h, f);
    const [consignedDesk] = consignPda(h.program.programId, desk);
    const { accrualPda } = await import("../sdk/src/pda");
    const [acc] = accrualPda(h.program.programId, owner.publicKey, idx);
    await expectFail(
      h.program.methods
        .registerConsignedInflow(bn(1_000))
        .accountsPartial({
          treasury: stranger.publicKey,
          config: f.config,
          epoch,
          pot: f.pot,
          consignedDesk,
          consignorAccrual: acc,
        })
        .signers([stranger])
        .rpc(),
      "Unauthorized",
    );
  });

  it("after finalize, unconsign returns the desk; record inactive; double-unconsign rejected", async function () {
    this.timeout(120_000);
    await finalizeCurrent(h, f);
    await unconsign(h, f, owner, desk);
    expect((await coreOwner(h, desk)).toBase58()).to.eq(owner.publicKey.toBase58());
    const cd = await h.program.account.consignedDesk.fetch(
      consignPda(h.program.programId, desk)[0],
    );
    expect(cd.active).to.eq(false);
    await expectFail(unconsign(h, f, owner, desk), "ConsignmentInactive");
    await expectFail(consignedInflow(h, f, desk, owner.publicKey, 1_000), "ConsignmentInactive");
    // Re-consign works (record reused).
    await consign(h, f, owner, desk);
    expect((await coreOwner(h, desk)).toBase58()).to.eq(f.vault.toBase58());
  });

  it("consign is blocked when consignment_enabled = false", async () => {
    const o2 = await fundWallet(h, 0.2 * LAMPORTS_PER_SOL);
    const d2 = await createDeskAsset(h, f.deskCollection, o2.publicKey);
    await setConfig(h, f, "consignmentEnabled", { bool: [false] });
    await expectFail(consign(h, f, o2, d2), "ConsignmentDisabled");
    await setConfig(h, f, "consignmentEnabled", { bool: [true] });
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
    await expectFail(call("hubSol"), "NotImplemented");
    await setConfig(h, f, "lpEnabled", { bool: [false] });
  });
});
