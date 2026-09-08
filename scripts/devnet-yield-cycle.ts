// One full treasury → pot → stakers → burn cycle on devnet, with every invariant asserted.
//   npx ts-node -T scripts/devnet-yield-cycle.ts [--sweep-price 0.05] [--desk-round 0.144]
//        [--inflow-c 0] [--hub-per-sol 1000000] [--no-sweep] [--quick]
//
// Mainnet model (§A5): OTC creator fees feed the OTC desk pot; every desk claims a desk-pot
// round (≈0.144 SOL/desk/day). Rounds claimed by TREASURY-OWNED desks are pot inflow source B;
// the treasury multisig books them with `register_treasury_inflow`. Stakers (activated desks)
// then share 90% by tier weight and 10% buys + burns $HUB. There is no OTC program on devnet, so
// the payer (= treasury) fronts the rounds; everything from the register call onward is real.
//
// Rounds are THRESHOLD-gated, like the OTC desk pot ("the moment the pot clears 0.1 SOL it is
// spent"): `finalize_epoch` is rejected until the open round's inflow reaches
// `Config.min_pot_threshold_lamports`, and allowed immediately after — no clock.
//
// 0. Bring the wallet current: if the open round is already at threshold, close it and claim, so
//    the cycle starts on a round that is below threshold.
// 1. Floor sweep (mock of the ME "accept listing" the multisig executes off-chain): a seller
//    lists a desk; the treasury pays `sweep-price` SOL and receives the desk in the same tx
//    (atomic SOL ↔ Core transfer) inside the §A6 caps. The sweep tx also creates the treasury's
//    $HUB ATA when missing. The desk stays treasury-owned → its rounds are source B.
// 2. Gate (negative): with the round below threshold, `finalize_epoch` → PotBelowThreshold and
//    `claim_yield` on a current desk → NothingToClaim.
//    Inflow: B = desk_round × treasury-owned desks, optional C.
//    Σw must NOT change — treasury desks feed the pot, they never take a tier.
// 3. `finalize_epoch` (allowed once ≥ threshold; topped up with C if the rounds fell short):
//    burn slice = ⌊inflow × burn_pct_bp / 10⁴⌋ → BurnState.burn_pending; the rest is credited
//    to `Config.acc_per_weight` as ⌊distributable × 10¹² / Σw⌋ per bp of weight.
// 4. `claim_yield` ONCE per owned tier: payout == ⌊(acc − stamp) × w / 10¹²⌋ — every round
//    closed since the desk's stamp in a single tx; the stamp catches up to `acc`.
// 5. Burn: keeper burns $HUB from its ATA (mock market buy at --hub-per-sol) and `record_burn`
//    reimburses burn-pending from the pot; BurnState + mint supply reflect it.
//
// --quick is the streamlined path (no sweep/mint): inflow → finalize → claim → burn on whatever
// treasury-owned desks already exist.
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  base58,
  createSignerFromKeypair,
  generateSigner,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import {
  fromWeb3JsKeypair,
  toWeb3JsInstruction,
  toWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";
import { create, fetchAsset, transferV1 } from "@metaplex-foundation/mpl-core";
import {
  ACC_SCALE,
  SWEEP_BUDGET_CAP_BP,
  SWEEP_PAYBACK_CAP_LAMPORTS,
  TIER_NAMES,
  TIER_WEIGHTS_BP,
  burnPda,
  epochPda,
  fetchOwnedDesks,
  otcPotPda,
  potPda,
  tierPda,
  treasuryPda,
} from "../sdk/src";
import {
  TOKEN_PROGRAM_ID,
  ata,
  claimAllOwned,
  claimYieldIx,
  devnetCtx,
  explorer,
  finalizeIx,
  hubAtaIx,
  openEpoch,
  otcAtaIx,
  ownedTieredDesks,
  registerInflow,
  roundStatus,
  sendIxs,
  settleRound,
  sol,
  tokenAmount,
  withIxs,
  type Ctx,
} from "./lib/devnet";

/** Attributes label on mock desks so the script can tell treasury-swept desks apart. */
const MOCK_ROLE = { key: "hub_mock_role", swept: "treasury-swept" };
/** §A5 source B reference: ≈0.144 SOL desk-pot take per desk per day at current OTC volume. */
const MAINNET_DESK_ROUND_SOL = 0.144;
const BPS = 10_000n;

const argNum = (name: string, dflt: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const lam = (s: number) => Math.round(s * LAMPORTS_PER_SOL);
const big = (v: BN | number | bigint) => BigInt(v.toString());
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "OK " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const failures: string[] = [];

/** Mint a mock desk to `owner` carrying a role label (tier is program state, never metadata). */
async function mintMockDesk(ctx: Ctx, collection: PublicKey, owner: PublicKey, role: string) {
  const asset = generateSigner(ctx.umi);
  await create(ctx.umi, {
    asset,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    owner: umiPk(owner.toBase58()),
    name: `OTC Desk (${role})`,
    uri: "https://arweave.net/9IlfJuOo6bR38UV87qxDeOzvKpF6_Gbq18RoQnvqOyw/1.json",
    plugins: [
      {
        type: "Attributes",
        attributeList: [
          { key: MOCK_ROLE.key, value: role },
          { key: "network", value: "devnet-mock" },
        ],
      },
    ],
  }).sendAndConfirm(ctx.umi);
  return asset;
}

/** Payer-owned desks in the collection whose mock label is `role` (treasury-swept = source B). */
async function ownedByRole(ctx: Ctx, collection: PublicKey, role: string) {
  const owned = await fetchOwnedDesks(ctx.connection, ctx.payer.publicKey, collection);
  const out: PublicKey[] = [];
  for (const asset of owned) {
    const a = await fetchAsset(ctx.umi, umiPk(asset.toBase58()));
    const attrs = a.attributes?.attributeList ?? [];
    if (attrs.some((kv) => kv.key === MOCK_ROLE.key && kv.value === role)) out.push(asset);
  }
  return out;
}

/**
 * Seller lists a desk; treasury buys it atomically (SOL out, Core asset in, one tx). The same
 * tx initializes the treasury's $HUB ATA when it does not exist yet (new desk owner → ATA).
 */
async function sweep(ctx: Ctx, collection: PublicKey, hubMint: PublicKey, price: number) {
  const seller = Keypair.generate();
  const asset = await mintMockDesk(ctx, collection, seller.publicKey, MOCK_ROLE.swept);
  const assetPk = toWeb3JsPublicKey(asset.publicKey);

  // §A6 guards the sweeper applies before proposing: ≤10% of treasury SOL, ≤ payback cap.
  const treasurySol = await ctx.connection.getBalance(ctx.payer.publicKey);
  const budgetCap = Math.floor((treasurySol * SWEEP_BUDGET_CAP_BP) / 10_000);
  check(
    "sweep within budget cap (10% of treasury SOL)",
    price <= budgetCap,
    `${sol(price)} ≤ ${sol(budgetCap)}`,
  );
  check(
    "sweep within payback cap",
    price <= SWEEP_PAYBACK_CAP_LAMPORTS,
    `${sol(price)} ≤ ${sol(SWEEP_PAYBACK_CAP_LAMPORTS)}`,
  );
  console.log(`  sweep_cost = price × 1.07 (taker + royalty) = ${sol(Math.round(price * 1.07))}`);

  const sellerSigner = createSignerFromKeypair(ctx.umi, fromWeb3JsKeypair(seller));
  const coreIxs = transferV1(ctx.umi, {
    asset: asset.publicKey,
    collection: umiPk(collection.toBase58()),
    authority: sellerSigner,
    newOwner: umiPk(ctx.payer.publicKey.toBase58()),
  })
    .getInstructions()
    .map(toWeb3JsInstruction);
  const ataIx = await hubAtaIx(ctx, ctx.payer.publicKey, hubMint);
  const sig = await sendIxs(
    ctx,
    [
      SystemProgram.transfer({
        fromPubkey: ctx.payer.publicKey,
        toPubkey: seller.publicKey,
        lamports: price,
      }),
      ...coreIxs,
      ...(ataIx ? [ataIx] : []),
    ],
    [seller],
  );
  const owner = toWeb3JsPublicKey((await fetchAsset(ctx.umi, asset.publicKey)).owner);
  check(
    "desk owned by treasury after atomic sweep",
    owner.equals(ctx.payer.publicKey),
    explorer(sig, "tx"),
  );
  check(
    "new owner has a $HUB ATA",
    (await tokenAmount(ctx, ata(ctx.payer.publicKey, hubMint))) !== null,
    ataIx ? "created in the sweep tx" : "already existed",
  );
  return assetPk;
}

/** spl-token `Burn` (ix 8). */
const burnIx = (account: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint) => {
  const data = Buffer.alloc(9);
  data[0] = 8;
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
};

/** Single-tx `claim_yield`; returns $OTC base units credited to the claimer's ATA. */
async function claimOneOtc(ctx: Ctx, asset: PublicKey, claimerOtc: PublicKey) {
  const before = (await tokenAmount(ctx, claimerOtc)) ?? 0n;
  const sig = await sendIxs(ctx, [await claimYieldIx(ctx, asset)]);
  const after = (await tokenAmount(ctx, claimerOtc)) ?? 0n;
  return { got: after - before, sig };
}

/** `$OTC` base units `claim_yield` would pay for `owedLamports` at the pot's lifetime average
 * buy rate — mirrors the on-chain price in `claim_yield` (tiers.rs) exactly. */
function otcDue(
  owedLamports: bigint,
  otcPot: { totalOtcBoughtUnits: bigint; totalLamportsSpent: bigint },
) {
  if (otcPot.totalLamportsSpent <= 0n) return 0n;
  return (owedLamports * otcPot.totalOtcBoughtUnits) / otcPot.totalLamportsSpent;
}

/** `(acc − stamp) × w / ACC_SCALE` — the program's `pending_yield` for one desk right now. */
async function pendingOf(ctx: Ctx, asset: PublicKey) {
  const t = await ctx.program.account.deskTier.fetch(tierPda(ctx.program.programId, asset)[0]);
  const c = await ctx.program.account.config.fetch(ctx.config);
  if (t.voided) return 0n;
  const w = BigInt(TIER_WEIGHTS_BP[t.tier - 1]);
  return ((big(c.accPerWeight) - big(t.stampAccPerWeight)) * w) / ACC_SCALE;
}

/** Program error code name from an Anchor rpc failure, or the raw message. */
const errName = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return m.match(/Error Code: (\w+)/)?.[1] ?? m.slice(0, 80);
};
async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
    return { ok: false, detail: "call succeeded" };
  } catch (e) {
    const name = errName(e);
    return { ok: name === code, detail: name };
  }
}

const mintSupply = async (ctx: Ctx, mint: PublicKey) =>
  (await ctx.connection.getAccountInfo(mint))!.data.readBigUInt64LE(36);

async function main() {
  const ctx = await devnetCtx();
  const cfg0 = await ctx.program.account.config.fetch(ctx.config);
  const [burnKey] = burnPda(ctx.program.programId);
  const [potKey] = potPda(ctx.program.programId);
  if (!cfg0.treasury.equals(ctx.payer.publicKey))
    throw new Error(`payer is not Config.treasury (${cfg0.treasury.toBase58()})`);
  if (!(await ctx.program.account.burnState.fetch(burnKey)).authority.equals(ctx.payer.publicKey)) {
    throw new Error("payer is not BurnState.authority");
  }
  if (cfg0.hubMint.equals(PublicKey.default))
    throw new Error("Config.hub_mint unset — devnet:mint");
  if (cfg0.otcMint.equals(PublicKey.default))
    throw new Error("Config.otc_mint unset — devnet:otc-mint");
  const [otcPotKey] = otcPotPda(ctx.program.programId);
  const otcPot0Raw = await ctx.program.account.otcPotState.fetchNullable(otcPotKey);
  if (!otcPot0Raw) throw new Error("OtcPotState not initialized — run devnet:otc-mint first");
  const quick = process.argv.includes("--quick");
  const doSweep = !quick && !process.argv.includes("--no-sweep");
  const price = lam(argNum("--sweep-price", 0.05));
  const deskRound = lam(argNum("--desk-round", MAINNET_DESK_ROUND_SOL));
  const inflowC = lam(argNum("--inflow-c", 0));
  const hubPerSol = argNum("--hub-per-sol", 1_000_000);
  const otcPerSol = argNum("--otc-per-sol", 5_000_000);
  const collection = cfg0.deskCollection;
  const claimerOtc = ata(ctx.payer.publicKey, cfg0.otcMint);

  console.log("\n[0] BRING CURRENT");
  // A leftover round already at threshold would make the negative gate check meaningless:
  // close it (and claim) first so the cycle starts on a round below threshold.
  const start = await roundStatus(ctx);
  if (start.ready) {
    console.log(
      `  open round #${start.idx} already at ${sol(start.effective)} ≥ threshold — closing`,
    );
    await settleRound(ctx);
  }
  const r0 = await claimAllOwned(ctx);
  if (r0.claims)
    console.log(`  caught up ${r0.claims} pending claim(s) → +${r0.received} $OTC units`);
  else if (r0.blocked)
    console.log(
      `  ${r0.desks} owned tier(s) have pending yield, but the $OTC vault isn't funded yet — leaving as-is`,
    );
  else console.log(`  ${r0.desks} owned tier(s), nothing pending`);

  console.log(`\n[1] DESK CUSTODY${quick ? " (--quick: reuse existing)" : ""}`);
  if (doSweep) await sweep(ctx, collection, cfg0.hubMint, price);
  const swept = await ownedByRole(ctx, collection, MOCK_ROLE.swept);
  console.log(`  treasury-owned (source B): ${swept.length} desk(s)`);

  console.log("\n[2] GATE + INFLOW — desk-pot rounds (mock OTC creator-fee take) → pot");
  const gate = await roundStatus(ctx);
  const ownedNow = await ownedTieredDesks(ctx);
  check(
    `round #${gate.idx} below threshold before inflow`,
    gate.effective < gate.threshold,
    `${sol(gate.effective)} < ${sol(gate.threshold)}${gate.carry ? ` (incl. ${gate.carry} lamport dust carry)` : ""}`,
  );
  {
    const r = await expectErr(finalizeIx(ctx, gate.idx), "PotBelowThreshold");
    check("finalize_epoch rejected below threshold", r.ok, r.detail);
  }
  if (ownedNow.length) {
    // Every owned tier was brought current in [0]; with no round closed since, nothing to claim.
    const r = await expectErr(
      sendIxs(ctx, [await claimYieldIx(ctx, ownedNow[0].asset)]),
      "NothingToClaim",
    );
    check("claim_yield rejected — no round closed since stamp", r.ok, r.detail);
  }

  console.log(
    `  desk_round ${sol(deskRound)} per desk (mainnet ref ≈ ${MAINNET_DESK_ROUND_SOL} SOL/desk/day)`,
  );
  const e0 = await openEpoch(ctx);
  const inflowB = deskRound * swept.length;
  const registerTreasury = async (source: "b" | "c", lamports: number) => {
    const sig = await registerInflow(ctx, source, lamports);
    console.log(`  source ${source.toUpperCase()} ${sol(lamports)} (${sig})`);
  };
  if (inflowB > 0) await registerTreasury("b", inflowB);
  if (inflowC > 0) await registerTreasury("c", inflowC);
  const e1 = await openEpoch(ctx);
  const pool = BigInt(inflowB + inflowC);
  check(
    "epoch inflow += B + C",
    big(e1.epoch.inflowLamports) - big(e0.epoch.inflowLamports) === pool,
    `${sol(e0.epoch.inflowLamports)} → ${sol(e1.epoch.inflowLamports)}`,
  );
  check(
    "pot liability += B + C",
    big(e1.cfg.potLiabilityLamports) - big(e0.cfg.potLiabilityLamports) === pool,
    `${sol(e0.cfg.potLiabilityLamports)} → ${sol(e1.cfg.potLiabilityLamports)}`,
  );
  check(
    "Σw unchanged by treasury desks",
    e1.cfg.totalWeightBp.eq(e0.cfg.totalWeightBp),
    `${e1.cfg.totalWeightBp} bp`,
  );

  console.log("\n[3] FINALIZE ROUND — allowed once inflow ≥ min_pot_threshold");
  const pre = await roundStatus(ctx);
  if (!pre.ready && pre.shortfall > 0) {
    console.log(
      `  rounds booked ${sol(pre.effective)} < threshold ${sol(pre.threshold)} — topping up ${sol(pre.shortfall)} (C)`,
    );
  }
  const burnBefore = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  const [treasuryStateKey] = treasuryPda(ctx.program.programId);
  const treasuryLpBefore = big(
    (await ctx.program.account.treasuryState.fetch(treasuryStateKey)).lpPendingLamports,
  );
  const otcPotBeforeFinalize = await ctx.program.account.otcPotState.fetch(otcPotKey);
  const otcPendingBefore = big(otcPotBeforeFinalize.otcPendingLamports);
  const acc0 = big(pre.cfg.accPerWeight);
  const { idx, epoch } = await settleRound(ctx, true);
  const cfg3 = await ctx.program.account.config.fetch(ctx.config);
  const inflow = big(epoch.inflowLamports);
  check(
    "finalize allowed at/above threshold (no clock)",
    inflow >= BigInt(pre.threshold),
    `${sol(inflow)} ≥ ${sol(pre.threshold)}`,
  );
  const expBurn = (inflow * BigInt(e1.cfg.burnPctBp)) / BPS; // bps_of: u128 floor
  check(
    `burn_pending == ⌊inflow × ${e1.cfg.burnPctBp} bp⌋`,
    big(epoch.burnPendingLamports) === expBurn,
    sol(expBurn),
  );
  const expLp = (inflow * BigInt(e1.cfg.lpPctBp)) / BPS; // §A5 5% LP-build earmark
  check(
    `lp_pending == ⌊inflow × ${e1.cfg.lpPctBp} bp⌋`,
    big(epoch.lpPendingLamports) === expLp,
    sol(expLp),
  );
  const distributable = inflow - expBurn - expLp; // remaining 90% == the $OTC leg
  const sw = big(epoch.totalWeightBp);
  const expPerW = (distributable * ACC_SCALE) / sw;
  check(
    "per_weight_scaled == ⌊distributable × 10¹² / Σw⌋",
    big(epoch.perWeightScaled) === expPerW,
    `${expPerW} per bp`,
  );
  check(
    "credited + floor remainder == distributable (remainder ≤ 1 lamport)",
    big(epoch.distributedLamports) + big(epoch.rolledForwardLamports) === distributable &&
      big(epoch.rolledForwardLamports) <= 1n,
    `credited ${sol(epoch.distributedLamports)} · remainder ${epoch.rolledForwardLamports} lamport(s)`,
  );
  check(
    "Config.acc_per_weight += per_weight_scaled",
    big(cfg3.accPerWeight) - acc0 === expPerW &&
      big(epoch.accPerWeightAfter) === big(cfg3.accPerWeight),
    `${acc0} → ${cfg3.accPerWeight}`,
  );
  check("Σw snapshot == Config.total_weight_bp", epoch.totalWeightBp.eq(e1.cfg.totalWeightBp));
  const burnAfter = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  check(
    "BurnState.burn_pending += slice",
    big(burnAfter) - big(burnBefore) === expBurn,
    sol(burnAfter),
  );
  const treasuryAfter = await ctx.program.account.treasuryState.fetch(treasuryStateKey);
  check(
    "TreasuryState.lp_pending += slice",
    big(treasuryAfter.lpPendingLamports) - treasuryLpBefore === expLp,
    sol(treasuryAfter.lpPendingLamports),
  );
  const otcPotAfterFinalize = await ctx.program.account.otcPotState.fetch(otcPotKey);
  check(
    "OtcPotState.otc_pending_lamports += credited (§A5 90% leg)",
    big(otcPotAfterFinalize.otcPendingLamports) - otcPendingBefore ===
      big(epoch.distributedLamports),
    sol(otcPotAfterFinalize.otcPendingLamports),
  );
  const next = await openEpoch(ctx);
  check(
    `next round #${next.idx} opens with the floor remainder only`,
    next.idx === idx + 1 && next.epoch.inflowLamports.eq(epoch.rolledForwardLamports),
    sol(next.epoch.inflowLamports),
  );

  console.log("\n[3b] OTC BUY — keeper deposits $OTC into the vault, reimbursed from the pot");
  const otcPending = big(otcPotAfterFinalize.otcPendingLamports);
  const otcUnits = (otcPending * BigInt(otcPerSol) * 1_000_000n) / BigInt(LAMPORTS_PER_SOL);
  const preamble = await otcAtaIx(ctx, ctx.payer.publicKey, cfg0.otcMint);
  if (preamble) await sendIxs(ctx, [preamble]);
  const keeperOtcRaw = await tokenAmount(ctx, ata(ctx.payer.publicKey, cfg0.otcMint));
  check(
    "keeper $OTC ATA exists",
    keeperOtcRaw !== null,
    preamble ? "created now" : "already existed",
  );
  const keeperOtc = keeperOtcRaw ?? 0n;
  if (keeperOtc < otcUnits) {
    throw new Error(
      `keeper holds ${keeperOtc} $OTC units but the mock buy needs ${otcUnits} — fund the ATA (devnet:otc-mint)`,
    );
  }
  const buyTxBytes = new Array(64).fill(0);
  buyTxBytes[0] = idx + 1; // unique per round so `last_buy_tx` never collides across cycle runs
  const liabBeforeBuy = (await ctx.program.account.config.fetch(ctx.config)).potLiabilityLamports;
  const buySig = await ctx.program.methods
    .recordOtcBuy(new BN(otcUnits.toString()), new BN(otcPending.toString()), buyTxBytes)
    .accountsPartial({
      keeper: ctx.payer.publicKey,
      config: ctx.config,
      otcPot: otcPotKey,
      otcMint: cfg0.otcMint,
      keeperOtc: ata(ctx.payer.publicKey, cfg0.otcMint),
      otcVault: otcPotAfterFinalize.otcVault,
      pot: potKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const otcPot1 = await ctx.program.account.otcPotState.fetch(otcPotKey);
  check(
    "otc_pending_lamports -= lamports_spent",
    otcPot1.otcPendingLamports.isZero(),
    `${sol(otcPotAfterFinalize.otcPendingLamports)} → ${sol(otcPot1.otcPendingLamports)} (${buySig})`,
  );
  check(
    "total_otc_bought_units / total_lamports_spent lifted",
    big(otcPot1.totalOtcBoughtUnits) === big(otcPotAfterFinalize.totalOtcBoughtUnits) + otcUnits &&
      big(otcPot1.totalLamportsSpent) === big(otcPotAfterFinalize.totalLamportsSpent) + otcPending,
    `${otcPot1.totalOtcBoughtUnits} units / ${sol(otcPot1.totalLamportsSpent)} spent`,
  );
  const liabAfterBuy = (await ctx.program.account.config.fetch(ctx.config)).potLiabilityLamports;
  check(
    "pot liability −= lamports_spent (reimbursed to keeper)",
    liabBeforeBuy.sub(liabAfterBuy).eq(new BN(otcPending.toString())),
  );

  console.log("\n[4] CLAIMS — one tx per desk settles every closed round (paid in $OTC)");
  const desks = await ownedTieredDesks(ctx);
  const dist = big(epoch.distributedLamports);
  TIER_NAMES.forEach((name, i) => {
    const w = BigInt(TIER_WEIGHTS_BP[i]);
    console.log(
      `  T${i + 1} ${name.padEnd(7)} w ${w} bp → ⌊per_w × w / 10¹²⌋ = ${sol((expPerW * w) / ACC_SCALE)}`,
    );
  });
  let claimedW = 0n;
  let sum = 0n;
  const dust0 = big(cfg3.dustScaled);
  for (const { asset, tier } of desks) {
    const w = BigInt(TIER_WEIGHTS_BP[tier.tier - 1]);
    const expected = await pendingOf(ctx, asset); // (acc − stamp) × w / 10¹², all rounds since stamp
    const thisRound = (expPerW * w) / ACC_SCALE;
    const expectedOtc = otcDue(expected, {
      totalOtcBoughtUnits: big(otcPot1.totalOtcBoughtUnits),
      totalLamportsSpent: big(otcPot1.totalLamportsSpent),
    });
    const { got: gotOtc } = await claimOneOtc(ctx, asset, claimerOtc);
    const t = await ctx.program.account.deskTier.fetch(tierPda(ctx.program.programId, asset)[0]);
    claimedW += w;
    sum += expected;
    check(
      `T${tier.tier} ${asset.toBase58().slice(0, 4)}… paid ${gotOtc} $OTC units in one tx`,
      gotOtc === expectedOtc && expected >= thisRound,
      `owed ${sol(expected)} lamport-equiv ≈ ${expectedOtc} $OTC${expected > thisRound ? ` (incl. ${sol(expected - thisRound)} from earlier rounds)` : ""}`,
    );
    check(
      `  stamp caught up to acc · lifetime ${sol(t.totalClaimedLamports)}`,
      t.stampAccPerWeight.eq(cfg3.accPerWeight) && big(t.totalClaimedLamports) >= expected,
    );
  }
  const cfg4 = await ctx.program.account.config.fetch(ctx.config);
  const fullCohort = claimedW === sw;
  if (fullCohort) {
    // Every staker is the payer → in scaled units, credited × 10¹² == per_w × Σw + slack, where
    // `slack` went to dust at finalize and each claim's sub-lamport fraction goes to dust now.
    // So (credited − Σ payouts) × 10¹² == Δdust since finalize + slack, exactly (zero-sum).
    // This invariant is lamport-equivalent bookkeeping — unaffected by the $OTC payout medium.
    const slack = dist * ACC_SCALE - expPerW * sw;
    const dustDelta = big(cfg4.dustScaled) - dust0;
    check(
      "Σ payouts + dust == credited (zero-sum; ≤ 1 lamport floor per claimer)",
      sum <= dist &&
        dist - sum <= BigInt(desks.length) &&
        dustDelta + slack === (dist - sum) * ACC_SCALE,
      `${desks.length} desks · ${sol(sum)} paid · ${dist - sum} lamport(s) to dust`,
    );
  } else {
    check(
      "Σ payouts ≤ credited",
      sum <= dist,
      `payer holds ${claimedW}/${sw} bp — other stakers own the rest (${sol(dist - sum)} still owed)`,
    );
  }
  if (desks.length) {
    const r = await expectErr(
      sendIxs(ctx, [await claimYieldIx(ctx, desks[0].asset)]),
      "NothingToClaim",
    );
    check("second claim in the same round rejected", r.ok, r.detail);
  }

  console.log("\n[5] BURN ($HUB) + record_burn");
  const pending = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  const hubUnits = (big(pending) * BigInt(hubPerSol) * 1_000_000n) / BigInt(LAMPORTS_PER_SOL);
  const keeperAta = ata(ctx.payer.publicKey, cfg0.hubMint);
  const ataIx = await hubAtaIx(ctx, ctx.payer.publicKey, cfg0.hubMint);
  if (ataIx) await sendIxs(ctx, [ataIx]);
  const keeperHubRaw = await tokenAmount(ctx, keeperAta);
  check(
    "keeper $HUB ATA exists",
    keeperHubRaw !== null,
    ataIx ? "created now" : keeperAta.toBase58(),
  );
  const keeperHub = keeperHubRaw ?? 0n;
  if (keeperHub < hubUnits) {
    throw new Error(
      `keeper holds ${keeperHub} $HUB units but the burn needs ${hubUnits} — fund the ATA (devnet:mint)`,
    );
  }
  const supplyBefore = await mintSupply(ctx, cfg0.hubMint);
  const burnedBefore = big((await ctx.program.account.burnState.fetch(burnKey)).totalHubBurned);
  const burnSig = await sendIxs(ctx, [
    burnIx(keeperAta, cfg0.hubMint, ctx.payer.publicKey, hubUnits),
  ]);
  const supplyAfter = await mintSupply(ctx, cfg0.hubMint);
  check(
    "$HUB supply reduced by burn",
    supplyBefore - supplyAfter === hubUnits,
    `−${hubUnits} units (${burnSig})`,
  );
  const sigBytes = Array.from(base58.serialize(burnSig));
  const liabBefore = (await ctx.program.account.config.fetch(ctx.config)).potLiabilityLamports;
  await ctx.program.methods
    .recordBurn(new BN(hubUnits.toString()), pending, sigBytes)
    .accountsPartial({
      keeper: ctx.payer.publicKey,
      config: ctx.config,
      burn: burnKey,
      pot: potKey,
    })
    .rpc();
  const b = await ctx.program.account.burnState.fetch(burnKey);
  const cfgEnd = await ctx.program.account.config.fetch(ctx.config);
  check(
    "burn_pending → 0 after record_burn",
    b.burnPendingLamports.isZero(),
    `reimbursed ${sol(pending)}`,
  );
  check(
    "total_hub_burned += burned",
    big(b.totalHubBurned) - burnedBefore === hubUnits,
    `${b.totalHubBurned.toString()} units`,
  );
  check("liability −= reimbursed", liabBefore.sub(cfgEnd.potLiabilityLamports).eq(pending));
  const potLamports = await ctx.connection.getBalance(potKey);
  const floor = await ctx.connection.getMinimumBalanceForRentExemption(0);
  check(
    "pot ≥ liability (solvent)",
    potLamports - floor >= cfgEnd.potLiabilityLamports.toNumber(),
    `${sol(potLamports)} vs ${sol(cfgEnd.potLiabilityLamports)}`,
  );

  console.log(`\n${failures.length ? `FAILED: ${failures.join("; ")}` : "ALL CHECKS PASSED"}`);
  if (failures.length) process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
