// Shared test harness. Runs against `anchor test` localnet by default; set
// HUB_CLUSTER=devnet to target Helius devnet with the §B5.1 funder guard.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import type { Hub } from "../target/types/hub";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey as umiPk,
  Umi,
} from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair, toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import {
  create,
  createCollection,
  transfer,
  fetchAsset,
  mplCore,
} from "@metaplex-foundation/mpl-core";

export type Harness = {
  provider: anchor.AnchorProvider;
  program: Program<Hub>;
  payer: Keypair;
  cluster: "localnet" | "devnet";
  umi: Umi;
  /** Shortened epoch used by initialize_config on test clusters. */
  epochSecs: number;
};

export const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const expand = (p: string) => p.replace(/^~/, os.homedir());

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(expand(p), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function devnetRpc(): string {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com";
}

/**
 * `anchor test` starts the suite as soon as the validator RPC answers (slot ~1). Simulate a
 * no-op transfer at `confirmed` until the validator accepts it, so the first real tx never
 * races validator startup.
 */
async function waitForConfirmed(connection: Connection, payer: PublicKey, timeoutMs = 60_000) {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const probe = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
    );
    const sim = await connection.simulateTransaction(probe, undefined, false);
    if (sim.value.err === null) return;
    lastErr = JSON.stringify(sim.value.err);
    await sleep(1000);
  }
  throw new Error(`localnet: validator never accepted a probe tx (${lastErr})`);
}

export async function setup(): Promise<Harness> {
  const cluster = (process.env.HUB_CLUSTER as Harness["cluster"]) || "localnet";
  let provider: anchor.AnchorProvider;

  if (cluster === "devnet") {
    const walletPath = process.env.HUB_WALLET || "~/.config/solana/hubconnect-devnet.json";
    const payer = loadKeypair(walletPath);
    const connection = new Connection(devnetRpc(), "confirmed");
    provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);
    await funderGuard(connection, payer.publicKey);
  } else {
    // Re-wrap the env provider at `confirmed`: Anchor defaults to `processed`, umi reads at
    // `confirmed`, and mixing the two makes Core-owner reads observe pre-tx state.
    const env = anchor.AnchorProvider.env();
    const connection = new Connection(env.connection.rpcEndpoint, "confirmed");
    provider = new anchor.AnchorProvider(connection, env.wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    await waitForConfirmed(connection, provider.wallet.publicKey);
  }

  const program = anchor.workspace.Hub as Program<Hub>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  // Explicit commitment: without it umi's web3 connection has none, so preflight falls back to
  // the RPC default (`finalized`), which lags ~30s behind on a freshly started test validator.
  const umi = createUmi(provider.connection.rpcEndpoint, "confirmed").use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(payer)));
  const epochSecs = Number(process.env.HUB_TEST_EPOCH_SECS || (cluster === "devnet" ? 20 : 8));
  return { provider, program, payer, cluster, umi, epochSecs };
}

/** Fund a fresh keypair from the payer (airdrops are rate-limited on devnet). */
export async function fundWallet(h: Harness, lamports: number): Promise<Keypair> {
  const kp = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: h.payer.publicKey, toPubkey: kp.publicKey, lamports }),
  );
  await h.provider.sendAndConfirm(tx, [h.payer]);
  return kp;
}

/** Mint a Core collection standing in for the OTC desk collection (§B5.1 mock). */
export async function createDeskCollection(h: Harness): Promise<PublicKey> {
  const col = generateSigner(h.umi);
  await createCollection(h.umi, {
    collection: col,
    name: "Mock Desks",
    uri: "https://mock/desks",
  }).sendAndConfirm(h.umi);
  return toWeb3JsPublicKey(col.publicKey);
}

/** Mint a Core desk asset in `collection` owned by `owner`. */
export async function createDeskAsset(
  h: Harness,
  collection: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const asset = generateSigner(h.umi);
  await create(h.umi, {
    asset,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    owner: umiPk(owner.toBase58()),
    name: "Mock Desk",
    uri: "https://mock/desk",
  }).sendAndConfirm(h.umi);
  return toWeb3JsPublicKey(asset.publicKey);
}

/** Transfer a Core asset (simulates a desk sale mid-epoch → lazy revocation). */
export async function transferDeskAsset(
  h: Harness,
  asset: PublicKey,
  collection: PublicKey,
  from: Keypair,
  to: PublicKey,
) {
  const signer = createSignerFromKeypair(h.umi, fromWeb3JsKeypair(from));
  await transfer(h.umi, {
    asset: { publicKey: umiPk(asset.toBase58()) } as never,
    collection: { publicKey: umiPk(collection.toBase58()) } as never,
    authority: signer,
    newOwner: umiPk(to.toBase58()),
  }).sendAndConfirm(h.umi);
}

export async function coreOwner(h: Harness, asset: PublicKey): Promise<PublicKey> {
  const a = await fetchAsset(h.umi, umiPk(asset.toBase58()));
  return toWeb3JsPublicKey(a.owner);
}

export type Fixture = {
  config: PublicKey;
  pot: PublicKey;
  burn: PublicKey;
  treasuryState: PublicKey;
  vault: PublicKey;
  deskCollection: PublicKey;
  opsWallet: PublicKey;
  /** On test clusters the payer doubles as treasury + burn authority so it can sign. */
  treasury: Keypair;
};

let fixture: Fixture | null = null;

/**
 * Config is a singleton per deployment. First caller initializes it with a real mock
 * Core collection and a short epoch; later callers (or devnet re-runs) read it back.
 */
export async function ensureInitialized(h: Harness): Promise<Fixture> {
  if (fixture) return fixture;
  const { configPda, potPda, burnPda, treasuryPda, vaultPda, epochPda } =
    await import("../sdk/src/pda");
  const id = h.program.programId;
  const [config] = configPda(id);
  const [pot] = potPda(id);
  const [burn] = burnPda(id);
  const [treasuryState] = treasuryPda(id);
  const [vault] = vaultPda(id);
  const [epoch0] = epochPda(id, 0);

  const existing = await h.program.account.config.fetchNullable(config);
  if (existing) {
    fixture = {
      config,
      pot,
      burn,
      treasuryState,
      vault,
      deskCollection: existing.deskCollection,
      opsWallet: existing.opsWallet,
      treasury: h.payer,
    };
    return fixture;
  }

  const deskCollection = await createDeskCollection(h);
  const opsWallet = Keypair.generate().publicKey;
  await h.program.methods
    .initializeConfig({
      opsWallet,
      treasury: h.payer.publicKey,
      otcProgram: Keypair.generate().publicKey,
      otcDeskPot: Keypair.generate().publicKey,
      deskCollection,
      hubMint: Keypair.generate().publicKey,
      otcMint: Keypair.generate().publicKey,
      epochDurationSecs: new anchor.BN(h.epochSecs),
    })
    .accountsPartial({ payer: h.payer.publicKey, config, pot, burn, treasuryState, vault, epoch0 })
    .rpc();
  fixture = {
    config,
    pot,
    burn,
    treasuryState,
    vault,
    deskCollection,
    opsWallet,
    treasury: h.payer,
  };
  return fixture;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the on-chain clock passes `endTs`. */
export async function waitForEpochEnd(h: Harness, endTs: number) {
  for (;;) {
    const slot = await h.provider.connection.getSlot();
    const now = await h.provider.connection.getBlockTime(slot);
    if (now !== null && now >= endTs) return;
    await sleep(1000);
  }
}

export async function expectFail(p: Promise<unknown>, code?: string) {
  try {
    await p;
  } catch (e: unknown) {
    if (code) {
      const msg = String((e as Error)?.message ?? e);
      if (!msg.includes(code)) throw new Error(`expected error ${code}, got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected failure${code ? ` (${code})` : ""} but call succeeded`);
}

/** §B5.1 — abort loudly instead of silently failing mid-suite on an empty funder. */
async function funderGuard(connection: Connection, funder: PublicKey) {
  const min = Number(process.env.HUB_DEVNET_MIN_SOL || 2);
  const bal = (await connection.getBalance(funder)) / LAMPORTS_PER_SOL;
  if (bal < min) {
    throw new Error(
      `devnet funder ${funder.toBase58()} has ${bal.toFixed(3)} SOL < ${min} SOL; ` +
        `airdrop first: solana airdrop 2 ${funder.toBase58()} -u devnet`,
    );
  }
}
