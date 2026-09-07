// Devnet stand-in for the mainnet "OTC Desks" Core collection (§B5.1 mock) + tiered test desks.
//   npx ts-node -T scripts/devnet-mock-desks.ts [--count 4] [--tiers 1,2,3,0] [--collection <pk>] [--force]
//
// 1. Creates a Core collection mirroring mainnet D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh
//    (name "OTC Desks", same Arweave URI, Royalties 5% → desk pot) unless --collection is given,
//    and points Config.desk_collection at it.
// 2. Mints `count` desks ("OTC Desk #n", per-desk Arweave JSON) to the payer wallet. Tier is
//    program state, not metadata: the Attributes plugin only labels the intended tier.
// 3. For each desk with tier target > 0: activate_tier (T1) then upgrade_tier up to the target,
//    paying 0.5 SOL per step (90% pot / 10% ops).
// 4. Verifies Config.total_weight_bp == Σ TIER_WEIGHTS_BP and that the dashboard's owner+collection
//    scan (`fetchOwnedDesks`, shared with web/ useWalletPortfolio) returns exactly these assets.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { generateSigner, publicKey as umiPk } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { create, createCollection, fetchCollection } from "@metaplex-foundation/mpl-core";
import {
  STEP_FEE_LAMPORTS,
  TIER_NAMES,
  TIER_WEIGHTS_BP,
  epochPda,
  fetchDeskTier,
  fetchOwnedDesks,
  potPda,
  tierPda,
} from "../sdk/src";
import { devnetCtx, explorer, setConfigPubkey, type Ctx } from "./lib/devnet";

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

async function mintDesk(ctx: Ctx, collection: PublicKey, n: number, tierTarget: number) {
  const asset = generateSigner(ctx.umi);
  const label = tierTarget ? `T${tierTarget} ${TIER_NAMES[tierTarget - 1]}` : "none";
  await create(ctx.umi, {
    asset,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    owner: umiPk(ctx.payer.publicKey.toBase58()),
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
  }).sendAndConfirm(ctx.umi);
  return toWeb3JsPublicKey(asset.publicKey);
}

async function setTier(ctx: Ctx, asset: PublicKey, target: number) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [epoch] = epochPda(ctx.program.programId, cfg.currentEpoch);
  const [pot] = potPda(ctx.program.programId);
  const [deskTier] = tierPda(ctx.program.programId, asset);
  const accounts = {
    payer: ctx.payer.publicKey,
    deskAsset: asset,
    config: ctx.config,
    epoch,
    pot,
    opsWallet: cfg.opsWallet,
    deskTier,
  };
  await ctx.program.methods.activateTier().accountsPartial(accounts).rpc();
  for (let t = 2; t <= target; t++) {
    await ctx.program.methods.upgradeTier(t).accountsPartial(accounts).rpc();
  }
}

async function main() {
  const ctx = await devnetCtx();
  const count = Number(arg("--count", "4"));
  const tiers = arg("--tiers", "1,2,3,0").split(",").map(Number);
  if (tiers.length !== count || tiers.some((t) => !(t >= 0 && t <= TIER_WEIGHTS_BP.length))) {
    throw new Error(`--tiers needs ${count} values in 0..${TIER_WEIGHTS_BP.length}`);
  }
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (
    cfg.totalWeightBp.toNumber() > 0 &&
    !arg("--collection", "") &&
    !process.argv.includes("--force")
  ) {
    throw new Error(
      "Σw > 0: switching desk_collection orphans live tiers — pass --collection or --force",
    );
  }
  const stepsSol = (tiers.reduce((s, t) => s + t, 0) * STEP_FEE_LAMPORTS) / LAMPORTS_PER_SOL;
  const bal = (await ctx.connection.getBalance(ctx.payer.publicKey)) / LAMPORTS_PER_SOL;
  if (bal < stepsSol + 0.15)
    throw new Error(`tier steps need ${stepsSol} SOL + rent; payer has ${bal.toFixed(3)}`);

  const collection = await ensureCollection(ctx, cfg.otcDeskPot);
  await setConfigPubkey(ctx, "deskCollection", collection);
  const start =
    Number((await fetchCollection(ctx.umi, umiPk(collection.toBase58()))).numMinted) + 1;

  const minted: PublicKey[] = [];
  for (let i = 0; i < count; i++) {
    const asset = await mintDesk(ctx, collection, start + i, tiers[i]);
    minted.push(asset);
    console.log(`desk #${start + i} ${asset.toBase58()} → target T${tiers[i]}`);
    if (tiers[i] > 0) await setTier(ctx, asset, tiers[i]);
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
