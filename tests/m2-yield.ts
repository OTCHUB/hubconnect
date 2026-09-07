// M2 — tiers, epochs, claims, lazy revocation, multi-epoch claims, burn (spec §B5 integration list).
// Epoch indices are never hardcoded: epochs are schedule-aligned, so tests read state from chain.
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  setup,
  Harness,
  ensureInitialized,
  Fixture,
  fundWallet,
  createDeskAsset,
  transferDeskAsset,
  coreOwner,
  expectFail,
} from "./harness";
import {
  activate,
  upgrade,
  claim,
  claimAll,
  inflow,
  finalizeCurrent,
  finalizeIdx,
  openEpoch,
  recordBurn,
  assertSolvent,
  currentEpoch,
  balance,
  txFee,
} from "./flows";
import { epochPda, tierPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

const tierOf = (h: Harness, asset: PublicKey) =>
  h.program.account.deskTier.fetch(tierPda(h.program.programId, asset)[0]);
const sumW = K.TIER_WEIGHTS_BP.reduce((a, b) => a + b, 0);

describe("M2 — yield engine", () => {
  let h: Harness;
  let f: Fixture;
  const owners: Keypair[] = [];
  const desks: PublicKey[] = [];
  let weightBefore = 0;

  before(async function () {
    this.timeout(180_000);
    h = await setup();
    f = await ensureInitialized(h);
    weightBefore = (await h.program.account.config.fetch(f.config)).totalWeightBp.toNumber();
    for (let i = 0; i < 4; i++) {
      const o = await fundWallet(h, 2.6 * LAMPORTS_PER_SOL);
      owners.push(o);
      desks.push(await createDeskAsset(h, f.deskCollection, o.publicKey));
    }
  });

  it("activate + upgrade to T1..T4 pays exact 90/10 split and accumulates Σw", async () => {
    const ops0 = await balance(h, f.opsWallet);
    const pot0 = await balance(h, f.pot);
    for (let i = 0; i < 4; i++) {
      await activate(h, f, owners[i], desks[i]);
      if (i > 0) await upgrade(h, f, owners[i], desks[i], i + 1);
      const t = await tierOf(h, desks[i]);
      expect(t.tier).to.eq(i + 1);
      expect(t.ownerAtActivation.toBase58()).to.eq(owners[i].publicKey.toBase58());
      await assertSolvent(h, f);
    }
    const { toOps, toPot } = K.splitFee(K.cumulativeFeeLamports(1 + 2 + 3 + 4));
    expect((await balance(h, f.opsWallet)) - ops0).to.eq(toOps);
    expect((await balance(h, f.pot)) - pot0).to.eq(toPot);
    const c = await h.program.account.config.fetch(f.config);
    expect(c.totalWeightBp.toNumber() - weightBefore).to.eq(sumW);
  });

  it("rejects double activation, non-owner activation, and non-step upgrades", async () => {
    await expectFail(activate(h, f, owners[0], desks[0]), "TierAlreadyActive");
    await expectFail(activate(h, f, owners[1], desks[0]), "NotDeskOwner");
    await expectFail(upgrade(h, f, owners[1], desks[1], 2), "InvalidTierStep");
    await expectFail(upgrade(h, f, owners[3], desks[3], 4), "TierMaxed");
    await expectFail(upgrade(h, f, owners[0], desks[0], 5), "InvalidTierStep");
  });

  let e0 = 0;
  it("finalize: 10% burn-pending, 90% distributed, invariant holds; early/double finalize rejected", async function () {
    this.timeout(180_000);
    e0 = await openEpoch(h, f);
    await expectFail(finalizeIdx(h, f, e0), "EpochNotEnded");
    await inflow(h, f, "b", LAMPORTS_PER_SOL);
    const inflowTotal = (await currentEpoch(h, f)).epoch.inflowLamports.toNumber();
    expect(inflowTotal).to.be.gte(LAMPORTS_PER_SOL);
    const burnBefore = (
      await h.program.account.burnState.fetch(f.burn)
    ).burnPendingLamports.toNumber();

    expect(await finalizeCurrent(h, f)).to.eq(e0);
    const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, e0)[0]);
    const burn = Math.floor((inflowTotal * K.BURN_PCT_BP) / K.BPS);
    expect(e.finalized).to.eq(true);
    expect(e.burnPendingLamports.toNumber()).to.eq(burn);
    expect(e.distributedLamports.toNumber()).to.eq(inflowTotal - burn);
    expect(e.rolledForwardLamports.toNumber()).to.eq(0);
    expect(e.totalWeightBp.toNumber()).to.eq(
      (await h.program.account.config.fetch(f.config)).totalWeightBp.toNumber(),
    );
    expect((await h.program.account.burnState.fetch(f.burn)).burnPendingLamports.toNumber()).to.eq(
      burnBefore + burn,
    );
    await assertSolvent(h, f);
    await expectFail(finalizeIdx(h, f, e0)); // already finalized (next epoch account exists)
  });

  it("claims pay exact per-weight lamports; Σ == distributed; out-of-order / unfinalized rejected", async () => {
    const [eKey] = epochPda(h.program.programId, e0);
    let paid = 0;
    for (let i = 0; i < 4; i++) paid += await claimAll(h, f, owners[i], desks[i]);
    const e = await h.program.account.epoch.fetch(eKey);
    if (weightBefore === 0)
      expect(e.claimedLamports.toNumber()).to.eq(e.distributedLamports.toNumber());
    expect(paid).to.be.gte(e.distributedLamports.toNumber() - 4); // ≤ 1 lamport rounding per claimer
    await assertSolvent(h, f);
    await expectFail(claim(h, f, owners[0], desks[0], e0), "ClaimOutOfOrder");
    const cur = await currentEpoch(h, f);
    await expectFail(claim(h, f, owners[0], desks[0], cur.idx), "EpochNotFinalized");
  });

  it("upgrade requires all finalized epochs claimed; then pays exactly the step difference", async function () {
    this.timeout(180_000);
    await finalizeCurrent(h, f); // finalized, unclaimed by everyone
    await expectFail(upgrade(h, f, owners[0], desks[0], 2), "ClaimBeforeUpgrade");
    await claimAll(h, f, owners[0], desks[0]);
    const pot0 = await balance(h, f.pot);
    await upgrade(h, f, owners[0], desks[0], 3);
    expect((await balance(h, f.pot)) - pot0).to.eq(K.splitFee(K.stepFeeLamports(1, 3)).toPot);
    expect((await tierOf(h, desks[0])).tier).to.eq(3);
  });

  it("multi-epoch: unclaimed epochs stay claimable after later finalizes (sequential claims)", async function () {
    this.timeout(180_000);
    await inflow(h, f, "c", LAMPORTS_PER_SOL / 2);
    await finalizeCurrent(h, f);
    const t0 = (await tierOf(h, desks[1])).nextClaimEpoch.toNumber();
    const got = await claimAll(h, f, owners[1], desks[1]);
    expect((await tierOf(h, desks[1])).nextClaimEpoch.toNumber() - t0).to.be.gte(2);
    expect(got).to.be.gt(0);
    await assertSolvent(h, f);
  });

  it("lazy revocation: transfer voids at claim (no payout); wash-transfer stays voided; re-activate at full price", async () => {
    const buyer = await fundWallet(h, 1.5 * LAMPORTS_PER_SOL);
    await transferDeskAsset(h, desks[2], f.deskCollection, owners[2], buyer.publicKey);
    expect((await coreOwner(h, desks[2])).toBase58()).to.eq(buyer.publicKey.toBase58());
    const w0 = (await h.program.account.config.fetch(f.config)).totalWeightBp.toNumber();
    const next = (await tierOf(h, desks[2])).nextClaimEpoch.toNumber();
    const b0 = await balance(h, owners[2].publicKey);
    await claim(h, f, owners[2], desks[2], next); // Ok, but voids
    expect((await tierOf(h, desks[2])).voided).to.eq(true);
    expect(await balance(h, owners[2].publicKey)).to.eq(b0);
    expect((await h.program.account.config.fetch(f.config)).totalWeightBp.toNumber()).to.eq(
      w0 - K.TIER_WEIGHTS_BP[2],
    );
    await expectFail(claim(h, f, buyer, desks[2], next), "TierVoided");
    await expectFail(upgrade(h, f, buyer, desks[2], 4), "TierVoided");
    await transferDeskAsset(h, desks[2], f.deskCollection, buyer, owners[2].publicKey);
    await expectFail(claim(h, f, owners[2], desks[2], next), "TierVoided");
    const pot0 = await balance(h, f.pot);
    await activate(h, f, owners[2], desks[2]);
    expect((await balance(h, f.pot)) - pot0).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toPot);
    const t2 = await tierOf(h, desks[2]);
    expect(t2.tier).to.eq(1);
    expect(t2.voided).to.eq(false);
    await assertSolvent(h, f);
  });

  it("record_burn reimburses keeper up to burn-pending; over-spend and replay rejected", async () => {
    const pending = (
      await h.program.account.burnState.fetch(f.burn)
    ).burnPendingLamports.toNumber();
    expect(pending).to.be.gt(0);
    const sig = Array.from(Keypair.generate().secretKey); // unique 64 bytes per run (replay guard)
    await expectFail(recordBurn(h, f, 1_000, pending + 1, sig), "BurnExceedsPending");
    const k0 = await balance(h, h.payer.publicKey);
    const pot0 = await balance(h, f.pot);
    const tx = await recordBurn(h, f, 1_000_000, pending, sig);
    // The localnet mint wallet holds 5e8 SOL (> 2^53 lamports), so JS numbers lose ≤ 64 lamports
    // of precision on the keeper side; the pot side is small and checked exactly.
    const keeperDelta = (await balance(h, h.payer.publicKey)) - k0;
    expect(Math.abs(keeperDelta - (pending - (await txFee(h, tx))))).to.be.lte(64);
    expect(pot0 - (await balance(h, f.pot))).to.eq(pending);
    const b = await h.program.account.burnState.fetch(f.burn);
    expect(b.burnPendingLamports.toNumber()).to.eq(0);
    expect(b.totalHubBurned.toNumber()).to.be.gte(1_000_000);
    await expectFail(recordBurn(h, f, 1, 1, sig));
    await assertSolvent(h, f);
  });
});
