// One full treasury → pot → stakers → burn cycle on devnet, with every invariant asserted.
//   npx ts-node -T scripts/devnet-yield-cycle.ts [--sweep-price 0.05] [--inflow-b 0.5] [--inflow-e 0.2]
//                                                 [--hub-per-sol 1000000] [--no-sweep]
//
// 1. Floor sweep (mock of the ME "accept listing" the treasury multisig executes off-chain):
//    a seller wallet lists a desk; the treasury pays `sweep-price` SOL and receives the desk in
//    the same transaction (atomic SOL ↔ Core transfer), inside the §A6 budget/payback caps. The
//    swept desk is then placed in program custody with `consign_desk` (vault PDA) so its
//    ownership is on-chain state (TreasuryState.desks_consigned) and it cannot be sold without
//    `unconsign_desk` after the consignment epoch closes.
// 2. Inflow: `register_treasury_inflow(B)` (treasury-desk yield) + `register_consigned_inflow`
//    (source E, the vault desk) move SOL into the pot and book it on the open epoch. Σw must NOT
//    change — treasury desks feed the pot, they never take a tier.
// 3. `finalize_epoch`: burn slice = 10% of inflow → BurnState.burn_pending; 90% → distributed.
// 4. `claim_yield` per owned tier: payout == ⌊distributed × w / Σw⌋, last claimer takes the
//    remainder so Σ payouts == distributed exactly.
// 5. Burn: keeper burns $HUB from its ATA (mock market buy at --hub-per-sol) and `record_burn`
//    reimburses burn-pending from the pot; BurnState + mint supply reflect it.
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
  TIER_WEIGHTS_BP,
  accrualPda,
  burnPda,
  consignPda,
  epochPda,
  potPda,
  tierPda,
  treasuryPda,
  vaultPda,
} from "../sdk/src";
import { TOKEN_PROGRAM_ID, ata } from "./devnet-hub-mint";
import {
  claimAllOwned,
  devnetCtx,
  explorer,
  openEpoch,
  ownedTieredDesks,
  sendIxs,
  settleEpoch,
  sol,
  type Ctx,
} from "./lib/devnet";

const argNum = (name: string, dflt: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const lam = (s: number) => Math.round(s * LAMPORTS_PER_SOL);
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "OK " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const failures: string[] = [];

/** Seller mints/lists a desk; treasury buys it atomically (SOL out, Core asset in, one tx). */
async function sweep(ctx: Ctx, collection: PublicKey, price: number) {
  const seller = Keypair.generate();
  const asset = generateSigner(ctx.umi);
  await create(ctx.umi, {
    asset,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    owner: umiPk(seller.publicKey.toBase58()),
    name: "OTC Desk (listed)",
    uri: "https://arweave.net/9IlfJuOo6bR38UV87qxDeOzvKpF6_Gbq18RoQnvqOyw/1.json",
  }).sendAndConfirm(ctx.umi);
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
  const sig = await sendIxs(
    ctx,
    [
      SystemProgram.transfer({
        fromPubkey: ctx.payer.publicKey,
        toPubkey: seller.publicKey,
        lamports: price,
      }),
      ...coreIxs,
    ],
    [seller],
  );
  const owner = toWeb3JsPublicKey((await fetchAsset(ctx.umi, asset.publicKey)).owner);
  check(
    "desk owned by treasury after atomic sweep",
    owner.equals(ctx.payer.publicKey),
    explorer(sig, "tx"),
  );
  return assetPk;
}

/** Program custody: treasury → vault PDA via consign_desk. */
async function consignToVault(ctx: Ctx, asset: PublicKey, collection: PublicKey) {
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
  const owner = toWeb3JsPublicKey((await fetchAsset(ctx.umi, umiPk(asset.toBase58()))).owner);
  const after = await ctx.program.account.treasuryState.fetch(treasuryState);
  check("Core owner == vault PDA", owner.equals(vault), `${vault.toBase58()} (${sig})`);
  check(
    "TreasuryState.desks_consigned +1",
    after.desksConsigned === before + 1,
    `${before} → ${after.desksConsigned}`,
  );
  return { vault, consignedDesk };
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
  const price = lam(argNum("--sweep-price", 0.05));
  const inflowB = lam(argNum("--inflow-b", 0.5));
  const inflowE = lam(argNum("--inflow-e", 0.2));
  const hubPerSol = argNum("--hub-per-sol", 1_000_000);

  // Bring every owned tier current so the cycle epoch is the only one left to claim.
  const start = await openEpoch(ctx);
  if (start.idx > 0) {
    const r = await claimAllOwned(ctx, start.idx - 1);
    if (r.claims) console.log(`caught up ${r.claims} pending claim(s) → +${sol(r.received)}`);
  }

  console.log("\n[1] FLOOR SWEEP → program custody");
  let consigned: PublicKey | null = null;
  if (!process.argv.includes("--no-sweep")) {
    consigned = await sweep(ctx, cfg0.deskCollection, price);
    await consignToVault(ctx, consigned, cfg0.deskCollection);
  }

  console.log("\n[2] INFLOW (treasury → pot)");
  const e0 = await openEpoch(ctx);
  const sigB = await ctx.program.methods
    .registerTreasuryInflow({ b: {} } as never, new BN(inflowB))
    .accountsPartial({
      treasury: ctx.payer.publicKey,
      config: ctx.config,
      epoch: e0.key,
      pot: potKey,
      treasuryState: treasuryPda(ctx.program.programId)[0],
    })
    .rpc();
  console.log(`  source B ${sol(inflowB)} (${sigB})`);
  if (consigned) {
    const [consignedDesk] = consignPda(ctx.program.programId, consigned);
    const [consignorAccrual] = accrualPda(ctx.program.programId, ctx.payer.publicKey, e0.idx);
    const sigE = await ctx.program.methods
      .registerConsignedInflow(new BN(inflowE))
      .accountsPartial({
        treasury: ctx.payer.publicKey,
        config: ctx.config,
        epoch: e0.key,
        pot: potKey,
        consignedDesk,
        consignorAccrual,
      })
      .rpc();
    console.log(`  source E ${sol(inflowE)} via consigned desk (${sigE})`);
  }
  const e1 = await openEpoch(ctx);
  const added = inflowB + (consigned ? inflowE : 0);
  check(
    "epoch inflow += B + E",
    e1.epoch.inflowLamports.sub(e0.epoch.inflowLamports).eq(new BN(added)),
    `${sol(e0.epoch.inflowLamports)} → ${sol(e1.epoch.inflowLamports)}`,
  );
  check(
    "pot liability += B + E",
    e1.cfg.potLiabilityLamports.sub(e0.cfg.potLiabilityLamports).eq(new BN(added)),
    `${sol(e0.cfg.potLiabilityLamports)} → ${sol(e1.cfg.potLiabilityLamports)}`,
  );
  check(
    "Σw unchanged by treasury desks",
    e1.cfg.totalWeightBp.eq(e0.cfg.totalWeightBp),
    `${e1.cfg.totalWeightBp} bp`,
  );

  console.log("\n[3] FINALIZE EPOCH");
  const burnBefore = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  const { idx, epoch } = await settleEpoch(ctx);
  const inflow = epoch.inflowLamports;
  const expBurn = inflow.muln(cfg0.burnPctBp).divn(10_000);
  check("burn_pending == 10% of inflow", epoch.burnPendingLamports.eq(expBurn), sol(expBurn));
  check(
    "distributed == inflow − burn",
    epoch.distributedLamports.eq(inflow.sub(expBurn)),
    sol(epoch.distributedLamports),
  );
  check("Σw snapshot == Config.total_weight_bp", epoch.totalWeightBp.eq(e1.cfg.totalWeightBp));
  const burnAfter = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  check("BurnState.burn_pending += slice", burnAfter.sub(burnBefore).eq(expBurn), sol(burnAfter));

  console.log("\n[4] CLAIMS (per-weight payouts)");
  const desks = await ownedTieredDesks(ctx);
  const dist = BigInt(epoch.distributedLamports.toString());
  const sw = BigInt(epoch.totalWeightBp.toString());
  let claimedW = 0n;
  let claimedL = 0n;
  let sum = 0;
  for (const { asset, tier } of desks) {
    const w = BigInt(TIER_WEIGHTS_BP[tier.tier - 1]);
    const expected = w === sw - claimedW ? dist - claimedL : (dist * w) / sw;
    const got = await claimOne(ctx, asset, idx);
    claimedW += w;
    claimedL += expected;
    sum += got;
    check(
      `T${tier.tier} ${asset.toBase58().slice(0, 4)}… paid ${sol(got)}`,
      BigInt(got) === expected,
      `expected ${sol(Number(expected))}`,
    );
  }
  const closed = await ctx.program.account.epoch.fetch(epochPda(ctx.program.programId, idx)[0]);
  check(
    "Σ payouts == distributed (no rounding loss)",
    BigInt(sum) === dist && closed.claimedLamports.eq(epoch.distributedLamports),
    `${desks.length} desks`,
  );
  check("claimed weight == Σw", closed.claimedWeightBp.eq(epoch.totalWeightBp));

  console.log("\n[5] BURN ($HUB) + record_burn");
  const pending = (await ctx.program.account.burnState.fetch(burnKey)).burnPendingLamports;
  const hubUnits =
    (BigInt(pending.toString()) * BigInt(hubPerSol) * 1_000_000n) / BigInt(LAMPORTS_PER_SOL);
  const supplyBefore = await mintSupply(ctx, cfg0.hubMint);
  const burnSig = await sendIxs(ctx, [
    burnIx(ata(ctx.payer.publicKey, cfg0.hubMint), cfg0.hubMint, ctx.payer.publicKey, hubUnits),
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
    b.totalHubBurned.gte(new BN(hubUnits.toString())),
    b.totalHubBurned.toString(),
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
