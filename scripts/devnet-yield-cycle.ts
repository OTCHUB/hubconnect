// One full treasury → pot → stakers → burn cycle on devnet, with every invariant asserted.
//   npx ts-node -T scripts/devnet-yield-cycle.ts [--sweep-price 0.05] [--desk-round 0.144]
//        [--inflow-c 0] [--hub-per-sol 1000000] [--no-sweep] [--consign] [--quick]
//
// Mainnet model (§A5): OTC creator fees feed the OTC desk pot; every desk claims a desk-pot
// round (≈0.144 SOL/desk/day). Rounds claimed by TREASURY-OWNED desks are pot inflow source B,
// rounds claimed on OWNER-CONSIGNED vault desks are source E; the treasury multisig books both
// with `register_treasury_inflow` / `register_consigned_inflow`. Stakers (activated desks) then
// share 90% by tier weight and 10% buys + burns $HUB. There is no OTC program on devnet, so the
// payer (= treasury) fronts the rounds; everything from the register call onward is real.
//
// 1. Floor sweep (mock of the ME "accept listing" the multisig executes off-chain): a seller
//    lists a desk; the treasury pays `sweep-price` SOL and receives the desk in the same tx
//    (atomic SOL ↔ Core transfer) inside the §A6 caps. The sweep tx also creates the treasury's
//    $HUB ATA when missing. The desk stays treasury-owned → its rounds are source B.
//    Consignment (§A6.1): an owner-sent desk goes into the vault PDA via `consign_desk`
//    (TreasuryState.desks_consigned) → its rounds are source E. Existing active consignments are
//    reused; --consign (or none existing) mints + consigns one more.
// 2. Inflow: B = desk_round × treasury-owned desks, E = desk_round per consigned desk (minus
//    `consignor_share_bp` credited to the consignor's StakerAccrual), optional C. Σw must NOT
//    change — treasury/vault desks feed the pot, they never take a tier.
// 3. `finalize_epoch`: burn slice = ⌊inflow × burn_pct_bp / 10⁴⌋ → BurnState.burn_pending; the
//    rest → distributed, Σw snapshotted.
// 4. `claim_yield` per owned tier, in program order: payout == ⌊distributed × w / Σw⌋ (u128),
//    the claimer whose weight equals the remaining unclaimed weight takes distributed − claimed
//    so Σ payouts == distributed exactly (no dust left in the pot).
// 5. Burn: keeper burns $HUB from its ATA (mock market buy at --hub-per-sol) and `record_burn`
//    reimburses burn-pending from the pot; BurnState + mint supply reflect it.
//
// --quick is the streamlined path (no sweep/consign/mint): inflow → finalize → claim → burn on
// whatever treasury-owned + consigned desks already exist.
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
  MPL_CORE_PROGRAM_ID,
  SWEEP_BUDGET_CAP_BP,
  SWEEP_PAYBACK_CAP_LAMPORTS,
  TIER_NAMES,
  TIER_WEIGHTS_BP,
  accrualPda,
  burnPda,
  consignPda,
  epochPda,
  fetchOwnedDesks,
  potPda,
  tierPda,
  treasuryPda,
  vaultPda,
} from "../sdk/src";
import {
  TOKEN_PROGRAM_ID,
  ata,
  claimAllOwned,
  devnetCtx,
  explorer,
  hubAtaIx,
  openEpoch,
  ownedTieredDesks,
  sendIxs,
  settleEpoch,
  sol,
  tokenAmount,
  withIxs,
  type Ctx,
} from "./lib/devnet";

/** Attributes label on mock desks so the script can tell treasury-swept from owner-consigned. */
const MOCK_ROLE = { key: "hub_mock_role", swept: "treasury-swept", consigned: "owner-consigned" };
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

/** Active `ConsignedDesk` records — the vault desks whose rounds are source E. */
async function activeConsignments(ctx: Ctx) {
  const all = await ctx.program.account.consignedDesk.all();
  return all
    .filter((c) => c.account.active)
    .map((c) => ({ asset: c.account.assetId, consignor: c.account.consignor, key: c.publicKey }));
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

/** §A6.1 owner-sent desk: mint to the payer (as desk owner) and consign it into the vault PDA. */
async function consignNewDesk(ctx: Ctx, collection: PublicKey) {
  const minted = await mintMockDesk(ctx, collection, ctx.payer.publicKey, MOCK_ROLE.consigned);
  const asset = toWeb3JsPublicKey(minted.publicKey);
  const [vault] = vaultPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const [consignedDesk] = consignPda(ctx.program.programId, asset);
  const before = (await ctx.program.account.treasuryState.fetch(treasuryState)).desksConsigned;
  const sig = await ctx.program.methods
    .consignDesk()
    .accountsPartial({
      owner: ctx.payer.publicKey,
      deskAsset: asset,
      deskCollection: collection,
      config: ctx.config,
      vault,
      treasuryState,
      consignedDesk,
      mplCoreProgram: new PublicKey(MPL_CORE_PROGRAM_ID),
    })
    .rpc();
  const owner = toWeb3JsPublicKey((await fetchAsset(ctx.umi, minted.publicKey)).owner);
  const after = await ctx.program.account.treasuryState.fetch(treasuryState);
  check("Core owner == vault PDA", owner.equals(vault), `${vault.toBase58()} (${sig})`);
  check(
    "TreasuryState.desks_consigned +1",
    after.desksConsigned === before + 1,
    `${before} → ${after.desksConsigned}`,
  );
  return asset;
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

async function claimOne(ctx: Ctx, asset: PublicKey, epochIdx: number) {
  const [pot] = potPda(ctx.program.programId);
  const [epoch] = epochPda(ctx.program.programId, epochIdx);
  const [deskTier] = tierPda(ctx.program.programId, asset);
  const before = await ctx.connection.getBalance(ctx.payer.publicKey);
  const sig = await ctx.program.methods
    .claimYield(new BN(epochIdx))
    .accountsPartial({
      claimer: ctx.payer.publicKey,
      deskAsset: asset,
      config: ctx.config,
      deskTier,
      epoch,
      pot,
    })
    .rpc();
  const tx = await ctx.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const after = await ctx.connection.getBalance(ctx.payer.publicKey);
  return after - before + (tx?.meta?.fee ?? 5000);
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
  const quick = process.argv.includes("--quick");
  const doSweep = !quick && !process.argv.includes("--no-sweep");
  const price = lam(argNum("--sweep-price", 0.05));
  const deskRound = lam(argNum("--desk-round", MAINNET_DESK_ROUND_SOL));
  const inflowC = lam(argNum("--inflow-c", 0));
  const hubPerSol = argNum("--hub-per-sol", 1_000_000);
  const collection = cfg0.deskCollection;

  // Bring every owned tier current so the cycle epoch is the only one left to claim.
  const start = await openEpoch(ctx);
  if (start.idx > 0) {
    const r = await claimAllOwned(ctx, start.idx - 1);
    if (r.claims) console.log(`caught up ${r.claims} pending claim(s) → +${sol(r.received)}`);
  }

  console.log(`\n[1] DESK CUSTODY${quick ? " (--quick: reuse existing)" : ""}`);
  if (doSweep) await sweep(ctx, collection, cfg0.hubMint, price);
  const consignments0 = await activeConsignments(ctx);
  if (!quick && (consignments0.length === 0 || process.argv.includes("--consign"))) {
    await consignNewDesk(ctx, collection);
  }
  const swept = await ownedByRole(ctx, collection, MOCK_ROLE.swept);
  const consignments = await activeConsignments(ctx);
  console.log(
    `  treasury-owned (source B): ${swept.length} desk(s) · consigned in vault (source E): ${consignments.length}`,
  );

  console.log("\n[2] INFLOW — desk-pot rounds (mock OTC creator-fee take) → pot");
  console.log(
    `  desk_round ${sol(deskRound)} per desk (mainnet ref ≈ ${MAINNET_DESK_ROUND_SOL} SOL/desk/day)`,
  );
  const e0 = await openEpoch(ctx);
  const shareBp = BigInt(e0.cfg.consignorShareBp);
  const inflowB = deskRound * swept.length;
  const [treasuryState] = treasuryPda(ctx.program.programId);
  const registerTreasury = async (source: "b" | "c", lamports: number) => {
    const sig = await ctx.program.methods
      .registerTreasuryInflow({ [source]: {} } as never, new BN(lamports))
      .accountsPartial({
        treasury: ctx.payer.publicKey,
        config: ctx.config,
        epoch: e0.key,
        pot: potKey,
        treasuryState,
      })
      .rpc();
    console.log(`  source ${source.toUpperCase()} ${sol(lamports)} (${sig})`);
  };
  if (inflowB > 0) await registerTreasury("b", inflowB);
  if (inflowC > 0) await registerTreasury("c", inflowC);
  let inflowE = 0n;
  let shareE = 0n;
  // Per consignor: accrual PDA for this epoch, owed before, and the share we expect it to gain.
  const accruals = new Map<string, { key: PublicKey; before: bigint; expected: bigint }>();
  for (const c of consignments) {
    const [consignorAccrual] = accrualPda(ctx.program.programId, c.consignor, e0.idx);
    const id = c.consignor.toBase58();
    if (!accruals.has(id)) {
      const prev = await ctx.program.account.stakerAccrual.fetchNullable(consignorAccrual);
      accruals.set(id, {
        key: consignorAccrual,
        before: prev ? big(prev.owedLamports) : 0n,
        expected: 0n,
      });
    }
    const sigE = await ctx.program.methods
      .registerConsignedInflow(new BN(deskRound))
      .accountsPartial({
        treasury: ctx.payer.publicKey,
        config: ctx.config,
        epoch: e0.key,
        pot: potKey,
        consignedDesk: c.key,
        consignorAccrual,
      })
      .rpc();
    const share = (BigInt(deskRound) * shareBp) / BPS;
    inflowE += BigInt(deskRound);
    shareE += share;
    accruals.get(id)!.expected += share;
    console.log(
      `  source E ${sol(deskRound)} via vault desk ${c.asset.toBase58().slice(0, 4)}… (${sigE})`,
    );
  }
  const e1 = await openEpoch(ctx);
  const pool = BigInt(inflowB + inflowC) + inflowE - shareE;
  check(
    `epoch inflow += B + C + (E − consignor share ${e0.cfg.consignorShareBp} bp)`,
    big(e1.epoch.inflowLamports) - big(e0.epoch.inflowLamports) === pool,
    `${sol(e0.epoch.inflowLamports)} → ${sol(e1.epoch.inflowLamports)}`,
  );
  check(
    "pot liability += B + C + E (pool + consignor share)",
    big(e1.cfg.potLiabilityLamports) - big(e0.cfg.potLiabilityLamports) === pool + shareE,
    `${sol(e0.cfg.potLiabilityLamports)} → ${sol(e1.cfg.potLiabilityLamports)}`,
  );
  check(
    "Σw unchanged by treasury / vault desks",
    e1.cfg.totalWeightBp.eq(e0.cfg.totalWeightBp),
    `${e1.cfg.totalWeightBp} bp`,
  );
  if (shareE > 0n) {
    for (const [wallet, a] of accruals) {
      const owed = big((await ctx.program.account.stakerAccrual.fetch(a.key)).owedLamports);
      check(
        `consignor ${wallet.slice(0, 4)}… StakerAccrual += share`,
        owed - a.before === a.expected,
        `${sol(a.before)} → ${sol(owed)}`,
      );
    }
  }

  console.log("\n[3] FINALIZE EPOCH");
  const burnBefore = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  const { idx, epoch } = await settleEpoch(ctx);
  const inflow = big(epoch.inflowLamports);
  const expBurn = (inflow * BigInt(e1.cfg.burnPctBp)) / BPS; // bps_of: u128 floor
  check(
    `burn_pending == ⌊inflow × ${e1.cfg.burnPctBp} bp⌋`,
    big(epoch.burnPendingLamports) === expBurn,
    sol(expBurn),
  );
  check(
    "distributed == inflow − burn",
    big(epoch.distributedLamports) === inflow - expBurn,
    sol(epoch.distributedLamports),
  );
  check("Σw snapshot == Config.total_weight_bp", epoch.totalWeightBp.eq(e1.cfg.totalWeightBp));
  const burnAfter = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  check(
    "BurnState.burn_pending += slice",
    big(burnAfter) - big(burnBefore) === expBurn,
    sol(burnAfter),
  );

  console.log("\n[4] CLAIMS — pro-rata by tier weight, program order");
  const desks = await ownedTieredDesks(ctx);
  const dist = big(epoch.distributedLamports);
  const sw = big(epoch.totalWeightBp);
  TIER_NAMES.forEach((name, i) => {
    const w = BigInt(TIER_WEIGHTS_BP[i]);
    console.log(
      `  T${i + 1} ${name.padEnd(7)} w ${w} bp → ⌊dist × w / Σw⌋ = ${sol((dist * w) / sw)}`,
    );
  });
  let claimedW = 0n;
  let claimedL = 0n;
  let sum = 0n;
  let remainder = 0n;
  for (const { asset, tier } of desks) {
    const w = BigInt(TIER_WEIGHTS_BP[tier.tier - 1]);
    const floorShare = (dist * w) / sw;
    // Mirrors claim_yield: the claimer holding exactly the remaining weight sweeps the dust.
    const last = w === sw - claimedW;
    const expected = last ? dist - claimedL : floorShare;
    if (last) remainder = expected - floorShare;
    const got = BigInt(await claimOne(ctx, asset, idx));
    claimedW += w;
    claimedL += expected;
    sum += got;
    check(
      `T${tier.tier} ${asset.toBase58().slice(0, 4)}… paid ${sol(got)}${last ? " (last claimer)" : ""}`,
      got === expected,
      `expected ${sol(expected)}${last && remainder ? ` incl. ${remainder} lamport remainder` : ""}`,
    );
  }
  const closed = await ctx.program.account.epoch.fetch(epochPda(ctx.program.programId, idx)[0]);
  const fullCohort = claimedW === sw;
  check(
    "Σ payouts == Σ expected · Epoch.claimed_lamports matches",
    sum === claimedL && big(closed.claimedLamports) === claimedL,
    `${desks.length} desks · ${sol(sum)}`,
  );
  if (fullCohort) {
    check(
      "Σ payouts == distributed (no dust left in pot)",
      sum === dist && big(closed.claimedLamports) === dist,
      `remainder ${remainder} lamport(s) absorbed by the last claimer`,
    );
    check("claimed weight == Σw", closed.claimedWeightBp.eq(epoch.totalWeightBp));
  } else {
    console.log(
      `  note: payer holds ${claimedW}/${sw} bp — other stakers own the rest; unclaimed ${sol(dist - sum)} rolls forward`,
    );
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
