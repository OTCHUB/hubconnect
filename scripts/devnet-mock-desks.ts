// Devnet stand-in for the mainnet "OTC Desks" Core collection (§B5.1 mock) + tiered test desks.
//   npx ts-node -T scripts/devnet-mock-desks.ts [--count 4] [--tiers 1,2,3,0] [--recycle]
//                                                [--new-collection [--force]] [--collection <pk>]
//
// 1. Reuses Config.desk_collection (the live mock) or, with --new-collection, creates a Core
//    collection mirroring mainnet D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh (name "OTC Desks",
//    same Arweave URI, Royalties 5% → desk pot) and points Config.desk_collection at it.
// 2. Mints `count` desks ("OTC Desk #n", per-desk Arweave JSON) to the payer wallet. Tier is
//    program state, not metadata: the Attributes plugin only labels the intended tier. Each mint
//    tx also initializes the owner's $HUB ATA when missing (idempotent), the way a mainnet desk
//    buyer needs one before their first burn / $HUB leg.
// 3. For each desk with tier target > 0: activate_tier + upgrade_tier(2..target) batched in one
//    transaction, each call paying its own ascending §A4 target-tier fee (T1 0.2 / T2 0.3 /
//    T3 0.4 / T4 0.5 SOL — 90% pot / 10% ops). --recycle finalizes the round and claims yield on
//    owned tiers whenever the payer runs short, so a 10-desk run fits a small faucet budget.
// 4. Verifies Config.total_weight_bp == Σ TIER_WEIGHTS_BP, pot ≥ liability (+ exact liability Δ when
//    not recycling), and that the dashboard's owner+collection scan (`fetchOwnedDesks`, shared
//    with web/ useWalletPortfolio) returns exactly these assets.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { generateSigner, publicKey as umiPk } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { create, createCollection, fetchCollection } from "@metaplex-foundation/mpl-core";
import {
  TIER_NAMES,
  TIER_STEP_FEE_LAMPORTS,
  TIER_WEIGHTS_BP,
  epochPda,
  fetchDeskTier,
  fetchOwnedDesks,
  potPda,
  splitFee,
  tierPda,
  tokenomicsPda,
} from "../sdk/src";
import {
  TOKEN_PROGRAM_ID,
  ata,
  claimAllOwned,
  devnetCtx,
  explorer,
  hubAtaIx,
  openEpoch,
  sendIxs,
  setConfigPubkey,
  settleRound,
  sol,
  withIxs,
  type Ctx,
} from "./lib/devnet";

/** Mainnet collection metadata (fetched 2026-09-07); reused so wallets render the real desk art. */
const OTC_DESKS = {
  name: "OTC Desks",
  uri: "https://arweave.net/QlISwCDfvXXyFlWHNYFvzqmcp62GA1hH9Tyyt4LAAoI",
  assetUri: (n: number) =>
    `https://arweave.net/9IlfJuOo6bR38UV87qxDeOzvKpF6_Gbq18RoQnvqOyw/${n}.json`,
  royaltyBps: 500,
};

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function ensureCollection(ctx: Ctx, potWallet: PublicKey): Promise<PublicKey> {
  const given = arg("--collection", "");
  if (given) return new PublicKey(given);
  const col = generateSigner(ctx.umi);
  await createCollection(ctx.umi, {
    collection: col,
    name: OTC_DESKS.name,
    uri: OTC_DESKS.uri,
    plugins: [
      {
        type: "Royalties",
        basisPoints: OTC_DESKS.royaltyBps,
        creators: [{ address: umiPk(potWallet.toBase58()), percentage: 100 }],
        ruleSet: { type: "None" },
      },
    ],
  }).sendAndConfirm(ctx.umi);
  const pk = toWeb3JsPublicKey(col.publicKey);
  console.log(`collection ${pk.toBase58()}  ${explorer(pk.toBase58())}`);
  return pk;
}

/** Mint one desk to `owner`; the same tx creates the owner's $HUB ATA if it does not exist yet. */
async function mintDesk(
  ctx: Ctx,
  collection: PublicKey,
  hubMint: PublicKey,
  n: number,
  tierTarget: number,
  owner = ctx.payer.publicKey,
) {
  const asset = generateSigner(ctx.umi);
  const label = tierTarget ? `T${tierTarget} ${TIER_NAMES[tierTarget - 1]}` : "none";
  const ataIx = await hubAtaIx(ctx, owner, hubMint);
  const builder = create(ctx.umi, {
    asset,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    owner: umiPk(owner.toBase58()),
    name: `OTC Desk #${n}`,
    uri: OTC_DESKS.assetUri(n),
    plugins: [
      {
        type: "Attributes",
        attributeList: [
          { key: "hub_tier_target", value: label },
          { key: "network", value: "devnet-mock" },
        ],
      },
    ],
  });
  await withIxs(builder, [ataIx]).sendAndConfirm(ctx.umi);
  if (!(await ctx.connection.getAccountInfo(ata(owner, hubMint)))) {
    throw new Error(`$HUB ATA for ${owner.toBase58()} missing after mint tx`);
  }
  return { asset: toWeb3JsPublicKey(asset.publicKey), ataCreated: ataIx !== null };
}

/** activate_tier + upgrade_tier(2..target) in ONE transaction: `target` steps × 0.5 SOL. */
async function setTier(ctx: Ctx, asset: PublicKey, target: number) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [epoch] = epochPda(ctx.program.programId, cfg.currentEpoch);
  const [pot] = potPda(ctx.program.programId);
  const [deskTier] = tierPda(ctx.program.programId, asset);
  const [tokenomics] = tokenomicsPda(ctx.program.programId);
  const tok = await ctx.program.account.tokenomicsConfig.fetchNullable(tokenomics);
  if (!tok)
    throw new Error(
      "TokenomicsConfig not initialized — run `npx ts-node -T scripts/devnet-init-tokenomics.ts` first",
    );
  const accounts = {
    payer: ctx.payer.publicKey,
    deskAsset: asset,
    config: ctx.config,
    epoch,
    pot,
    opsWallet: cfg.opsWallet,
    hubMint: cfg.hubMint,
    payerHub: ata(ctx.payer.publicKey, cfg.hubMint),
    tokenProgram: TOKEN_PROGRAM_ID,
    deskTier,
    tokenomics,
    treasuryLockVault: tok.treasuryLockVault,
  };
  const ixs = [await ctx.program.methods.activateTier(1).accountsPartial(accounts).instruction()];
  for (let t = 2; t <= target; t++) {
    ixs.push(await ctx.program.methods.upgradeTier(t).accountsPartial(accounts).instruction());
  }
  return sendIxs(ctx, ixs);
}

/** Gross SOL fee for one desk activating T1 then stepping T2..target one tier at a time — each
 *  call pays only *its own* target tier's ascending flat fee (§A4 revised), not a flat rate. */
const grossFeeForTarget = (target: number) =>
  TIER_STEP_FEE_LAMPORTS.slice(0, target).reduce((s, f) => s + f, 0);

/** Net payer cost of activating to `target`: 90% of each call's fee goes to the pot (10% returns
 *  via ops_wallet when the payer *is* ops_wallet). */
const netStepCost = (target: number, opsIsPayer: boolean) =>
  grossFeeForTarget(target) * (opsIsPayer ? 0.9 : 1) + 0.02 * LAMPORTS_PER_SOL;

/**
 * --recycle: when the payer cannot fund the next desk's steps, close the open round (step fees
 * already booked ≥ 0.45 SOL, well past the 0.1 SOL threshold) and claim yield on every owned
 * tier — 90% of the step fees paid so far come back (10% is burn slice).
 */
async function ensureFunds(ctx: Ctx, lamports: number, recycle: boolean) {
  const bal = await ctx.connection.getBalance(ctx.payer.publicKey);
  if (bal >= lamports) return;
  if (!recycle) {
    throw new Error(
      `need ${sol(lamports)} for the next desk; payer has ${sol(bal)} (pass --recycle)`,
    );
  }
  console.log(`payer ${sol(bal)} < ${sol(lamports)} — recycling via finalize + claim_yield`);
  await settleRound(ctx);
  const r = await claimAllOwned(ctx);
  console.log(`  ${r.claims} single-tx claim(s) on ${r.desks} desks → +${sol(r.received)}`);
  const now = await ctx.connection.getBalance(ctx.payer.publicKey);
  if (now < lamports) throw new Error(`still short after recycle: ${sol(now)} < ${sol(lamports)}`);
}

async function main() {
  const ctx = await devnetCtx();
  const count = Number(arg("--count", "4"));
  const tiers = arg("--tiers", "1,2,3,0").split(",").map(Number);
  const recycle = process.argv.includes("--recycle");
  if (tiers.length !== count || tiers.some((t) => !(t >= 0 && t <= TIER_WEIGHTS_BP.length))) {
    throw new Error(`--tiers needs ${count} values in 0..${TIER_WEIGHTS_BP.length}`);
  }
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  // Reuse the live mock collection by default: switching desk_collection orphans live tiers.
  const liveMock =
    !cfg.deskCollection.equals(PublicKey.default) && !process.argv.includes("--new-collection");
  const collection = liveMock ? cfg.deskCollection : await ensureCollection(ctx, cfg.otcDeskPot);
  if (!liveMock && cfg.totalWeightBp.toNumber() > 0 && !process.argv.includes("--force")) {
    throw new Error("Σw > 0: switching desk_collection orphans live tiers — pass --force");
  }
  await setConfigPubkey(ctx, "deskCollection", collection);
  const opsIsPayer = cfg.opsWallet.equals(ctx.payer.publicKey);
  const totalSteps = tiers.reduce((s, t) => s + t, 0);
  const grossFee = tiers.reduce((s, t) => s + grossFeeForTarget(t), 0);
  const needed = tiers.reduce((s, t) => s + netStepCost(t, opsIsPayer), 0);
  const bal = await ctx.connection.getBalance(ctx.payer.publicKey);
  console.log(
    `${count} desks · ${totalSteps} tier steps = ${sol(grossFee)} gross (ascending §A4 schedule) · payer ${sol(bal)}${recycle ? " · --recycle on" : ""}`,
  );
  if (!recycle && bal < needed) {
    throw new Error(`tier steps need ~${sol(needed)}; pass --recycle`);
  }
  const start =
    Number((await fetchCollection(ctx.umi, umiPk(collection.toBase58()))).numMinted) + 1;

  // Mint first (cheap: rent only), then activate so a recycle pause never leaves a desk half-set.
  const minted: PublicKey[] = [];
  for (let i = 0; i < count; i++) {
    const { asset, ataCreated } = await mintDesk(ctx, collection, cfg.hubMint, start + i, tiers[i]);
    minted.push(asset);
    console.log(
      `desk #${start + i} ${asset.toBase58()} → target T${tiers[i]}${ataCreated ? " · owner $HUB ATA created in mint tx" : ""}`,
    );
  }
  console.log(`owner $HUB ATA ${ata(ctx.payer.publicKey, cfg.hubMint).toBase58()} · OK`);
  for (let i = 0; i < count; i++) {
    if (tiers[i] === 0) continue;
    await ensureFunds(ctx, netStepCost(tiers[i], opsIsPayer), recycle);
    const sig = await setTier(ctx, minted[i], tiers[i]);
    console.log(`  #${start + i} → T${tiers[i]} ${TIER_NAMES[tiers[i] - 1]} in one tx (${sig})`);
  }

  // Σw: the program's running total must equal the sum of the tier weights we just set.
  const weightBefore = cfg.totalWeightBp.toNumber();
  const expected =
    weightBefore + tiers.filter(Boolean).reduce((s, t) => s + TIER_WEIGHTS_BP[t - 1], 0);
  const after = await ctx.program.account.config.fetch(ctx.config);
  const ok = after.totalWeightBp.toNumber() === expected;
  console.log(
    `Σ_WEIGHT on-chain ${after.totalWeightBp.toNumber()} bp · expected ${expected} bp · ${ok ? "OK" : "MISMATCH"}`,
  );
  // Pot liability: every step books 90% of its own ascending target-tier fee as inflow.
  // With --recycle a round may have been finalized/claimed mid-run, so only solvency is
  // checked in that mode.
  const [potKey] = potPda(ctx.program.programId);
  const potLamports = await ctx.connection.getBalance(potKey);
  const floor = await ctx.connection.getMinimumBalanceForRentExemption(0);
  const liability = after.potLiabilityLamports.toNumber();
  const { epoch } = await openEpoch(ctx);
  const solvent = potLamports - floor >= liability;
  console.log(
    `POT ${sol(potLamports)} · liability ${sol(liability)} · open-epoch inflow ${sol(epoch.inflowLamports)} · ${solvent ? "SOLVENT" : "UNDERWATER"}`,
  );
  if (!recycle) {
    const expLiab =
      cfg.potLiabilityLamports.toNumber() +
      tiers.reduce((s, t) => s + splitFee(grossFeeForTarget(t)).toPot, 0);
    console.log(
      `  liability Δ expected ${sol(expLiab)} · ${liability === expLiab ? "OK" : "MISMATCH"}`,
    );
    if (liability !== expLiab) process.exit(2);
  }
  if (!solvent) process.exit(2);

  // Same scan the dashboard runs for a connected wallet.
  const seen = await fetchOwnedDesks(ctx.connection, ctx.payer.publicKey, collection);
  const seenSet = new Set(seen.map((k) => k.toBase58()));
  const allFound = minted.every((k) => seenSet.has(k.toBase58()));
  console.log(
    `portfolio scan: ${seen.length} desks for payer in collection · minted found: ${allFound ? "OK" : "MISSING"}`,
  );
  for (const asset of seen) {
    const t = await fetchDeskTier(ctx.program, asset);
    console.log(
      `  ${asset.toBase58()}  tier ${t ? `T${t.tier} ${TIER_NAMES[t.tier - 1]} (${TIER_WEIGHTS_BP[t.tier - 1]} bp)` : "— not activated"}`,
    );
  }
  if (!ok || !allFound) process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
