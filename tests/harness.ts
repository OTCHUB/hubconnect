// Shared test harness. Runs against `anchor test` localnet by default; set
// HUB_CLUSTER=devnet to target Helius devnet with the §B5.1 funder guard.
import "dotenv/config";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import type { Hub } from "../target/types/hub";
import * as K from "../sdk/src/constants";
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
  /** Round-close threshold passed to initialize_config (Appendix default 0.1 SOL). */
  thresholdLamports: number;
};

export const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const TOKEN_PROGRAM_ID = new PublicKey(K.TOKEN_PROGRAM_ID);
export const ATA_PROGRAM_ID = new PublicKey(K.ASSOCIATED_TOKEN_PROGRAM_ID);
const MINT_SIZE = 82;

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
  const thresholdLamports = Number(
    process.env.HUB_TEST_THRESHOLD_LAMPORTS || LAMPORTS_PER_SOL / 10,
  );
  return { provider, program, payer, cluster, umi, thresholdLamports };
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

// Raw spl-token / associated-token helpers (no @solana/spl-token dependency); layouts mirror
// scripts/devnet-hub-mint.ts, which tests must not import (env side effects).
const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];

/** associated-token `CreateIdempotent` (ix 1); works for PDA (off-curve) owners too. */
export function createAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Mock SPL mint with the payer as mint authority (`InitializeMint2`, ix 20; no freeze authority). */
export async function createSplMint(h: Harness, decimals: number): Promise<PublicKey> {
  const mint = Keypair.generate();
  const rent = await h.provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: h.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
      data: Buffer.concat([
        Buffer.from([20, decimals]),
        h.payer.publicKey.toBuffer(),
        Buffer.from([0]),
      ]),
    }),
  );
  await h.provider.sendAndConfirm(tx, [h.payer, mint]);
  return mint.publicKey;
}

/** spl-token `MintTo` (ix 7) signed by the payer (mint authority). */
export async function mintTo(h: Harness, mint: PublicKey, dest: PublicKey, amount: bigint) {
  const ix = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: h.payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), u64le(amount)]),
  });
  await h.provider.sendAndConfirm(new Transaction().add(ix), [h.payer]);
}

/** Raw u64 `amount` of an spl-token account (offset 64). */
export async function tokenBalance(h: Harness, tokenAccount: PublicKey): Promise<bigint> {
  const info = await h.provider.connection.getAccountInfo(tokenAccount);
  if (!info) throw new Error(`token account ${tokenAccount.toBase58()} does not exist`);
  return info.data.readBigUInt64LE(64);
}

const TOKEN_ACCOUNT_SIZE = 165;

/** spl-token `InitializeAccount3` (ix 18): account · mint · owner (no Rent sysvar needed). */
function initializeAccount3(account: PublicKey, mint: PublicKey, owner: PublicKey) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]),
  });
}

/** Fresh plain (non-ATA) spl-token account — needed whenever an owner needs two-or-more
 * accounts of the same mint (an ATA can only ever represent one); mirrors
 * `scripts/devnet-treasury-float.ts`, which tests must not import (env side effects). */
async function createTokenAccount(
  h: Harness,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const account = Keypair.generate();
  const rent = await h.provider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: h.payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports: rent,
      space: TOKEN_ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeAccount3(account.publicKey, mint, owner),
  );
  await h.provider.sendAndConfirm(tx, [h.payer, account]);
  return account.publicKey;
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
  /** Real SPL mint backing `config.hub_mint` — activate_tier/upgrade_tier burn from it. */
  hubMint: PublicKey;
  /** Real SPL mint backing `config.otc_mint` — the §A5 yield leg is paid out in this. */
  otcMint: PublicKey;
  /** Real SPL mint backing `config.usdc_mint` — the two-hop `finalize_epoch` swap's
   * intermediate leg (hop1's WSOL→USDC destination, hop2's USDC→$HUB source). */
  usdcMint: PublicKey;
  /** Vault-owned USDC scratch ATA on `TreasuryState.vault_usdc` (`init_treasury_float`). */
  vaultUsdc: PublicKey;
  /** `["otc_pot"]` — §A5 lifetime-average-buy-rate bookkeeping for `claim_yield`. */
  otcPot: PublicKey;
  /** Pot-owned $OTC token account `record_otc_buy` deposits into / `claim_yield` pays from. */
  otcVault: PublicKey;
  /** `opsWallet`'s $OTC account — the ops leg of `activate_tier_otc` / `upgrade_tier_otc`. */
  opsOtc: PublicKey;
  /** Payer's own $OTC account, funded once, used as the `record_otc_buy` source in tests. */
  keeperOtc: PublicKey;
  /** `["tokenomics"]` — Appendix supply plan + airdrop root + reward-pool bookkeeping. */
  tokenomics: PublicKey;
  /** Vault-owned $HUB scratch account recorded on `TokenomicsConfig` at `init_tokenomics` — the
   * 50%-of-cost "reward" leg of `activate_tier`/`upgrade_tier`'s burn split lands here. */
  treasuryLockVault: PublicKey;
};

let fixture: Fixture | null = null;

/**
 * Config is a singleton per deployment. First caller initializes it with a real mock
 * Core collection; later callers (or devnet re-runs) read it back.
 */
export async function ensureInitialized(h: Harness): Promise<Fixture> {
  if (fixture) return fixture;
  const { configPda, potPda, burnPda, treasuryPda, vaultPda, epochPda, otcPotPda, tokenomicsPda } =
    await import("../sdk/src/pda");
  const id = h.program.programId;
  const [config] = configPda(id);
  const [pot] = potPda(id);
  const [burn] = burnPda(id);
  const [treasuryState] = treasuryPda(id);
  const [vault] = vaultPda(id);
  const [epoch0] = epochPda(id, 0);
  const [otcPot] = otcPotPda(id);
  const [tokenomics] = tokenomicsPda(id);

  const existing = await h.program.account.config.fetchNullable(config);
  if (existing) {
    const otcVault = ata(pot, existing.otcMint);
    const opsOtc = ata(existing.opsWallet, existing.otcMint);
    const keeperOtc = ata(h.payer.publicKey, existing.otcMint);
    const existingTreasury = await h.program.account.treasuryState.fetch(treasuryState);
    // §A7.1 tokenomics singleton — required by activate_tier/upgrade_tier's 50/50 burn-split
    // (Config.tier_cost_burn_bp) since it owns treasury_lock_vault, the reward-pool destination.
    // Devnet re-runs may predate this requirement, so create it lazily if still missing.
    const treasuryLockVault = await initTokenomicsIfMissing(
      h,
      config,
      treasuryState,
      vault,
      existing.hubMint,
      tokenomics,
    );
    fixture = {
      config,
      pot,
      burn,
      treasuryState,
      vault,
      deskCollection: existing.deskCollection,
      opsWallet: existing.opsWallet,
      treasury: h.payer,
      hubMint: existing.hubMint,
      otcMint: existing.otcMint,
      usdcMint: existing.usdcMint,
      vaultUsdc: existingTreasury.vaultUsdc,
      otcPot,
      otcVault,
      opsOtc,
      keeperOtc,
      tokenomics,
      treasuryLockVault,
    };
    return fixture;
  }

  const deskCollection = await createDeskCollection(h);
  const opsWallet = Keypair.generate().publicKey;
  // Real mints, not placeholder keys: activate_tier/upgrade_tier burn from hubMint, and
  // claim_yield / record_otc_buy move real balances through otcMint's pot-owned vault.
  const hubMint = await createSplMint(h, 6);
  const otcMint = await createSplMint(h, 6);
  // Two-hop `finalize_epoch`'s intermediate USDC leg — a plain test SPL mint, same as
  // hubMint/otcMint above; the real USDC mint has no meaning on a forked-mainnet test
  // validator without a matching pool for this run's freshly-minted $HUB.
  const usdcMint = await createSplMint(h, 6);
  const otcVault = ata(pot, otcMint);
  const opsOtc = ata(opsWallet, otcMint);
  const keeperOtc = ata(h.payer.publicKey, otcMint);

  await h.program.methods
    .initializeConfig({
      opsWallet,
      treasury: h.payer.publicKey,
      otcProgram: Keypair.generate().publicKey,
      otcDeskPot: Keypair.generate().publicKey,
      deskCollection,
      hubMint,
      otcMint,
      usdcMint,
      minPotThresholdLamports: new anchor.BN(h.thresholdLamports),
    })
    .accountsPartial({ payer: h.payer.publicKey, config, pot, burn, treasuryState, vault, epoch0 })
    .rpc();

  // §A5 otc_pot bookkeeping: pot-owned vault + payer-as-keeper source account, then the
  // one-time init that wires them together and appoints the payer as the buy-recording keeper.
  // Also create opsWallet's $OTC account here — the ops leg of activate_tier_otc/upgrade_tier_otc
  // (opsWallet is never a signer, so anyone may fund its ATA; the payer does it once, up front).
  await h.provider.sendAndConfirm(
    new Transaction().add(
      createAtaIx(h.payer.publicKey, pot, otcMint),
      createAtaIx(h.payer.publicKey, h.payer.publicKey, otcMint),
      createAtaIx(h.payer.publicKey, opsWallet, otcMint),
    ),
    [h.payer],
  );
  await h.program.methods
    .initOtcPot(h.payer.publicKey)
    .accountsPartial({ authority: h.payer.publicKey, config, otcVault, otcPot })
    .rpc();
  // Deep $OTC supply so the keeper can always fund a 1:1 base-unit buy for every round's
  // credited amount in tests (see flows.ts `settleOtcPending`).
  await mintTo(h, otcMint, keeperOtc, 10_000_000_000_000n);

  // §A6.3/§A7.1 bridge: `finalize_epoch`'s synchronous Jupiter legs (vault_wsol/vault_hub/
  // treasury_float_vault) gate on TreasuryState.vault_hub != default, so this must run before
  // any finalize_epoch call — mirrors `scripts/devnet-treasury-float.ts` (not imported directly;
  // tests must not pull in scripts' env side effects). vault_hub and treasury_float_vault share
  // (owner, mint), which an ATA can't represent twice, so both are plain spl-token accounts.
  const wsolMint = new PublicKey(K.WSOL_MINT);
  const vaultWsol = await createTokenAccount(h, wsolMint, vault);
  const vaultUsdc = await createTokenAccount(h, usdcMint, vault);
  const vaultHub = await createTokenAccount(h, hubMint, vault);
  const treasuryFloatVault = await createTokenAccount(h, hubMint, vault);
  await h.program.methods
    .initTreasuryFloat()
    .accountsPartial({
      treasury: h.payer.publicKey,
      config,
      treasuryState,
      vault,
      vaultWsol,
      vaultUsdc,
      vaultHub,
      treasuryFloatVault,
    })
    .rpc();

  // §A7.1 tokenomics singleton — activate_tier/upgrade_tier's 50/50 burn-split
  // (Config.tier_cost_burn_bp) needs treasury_lock_vault as its reward-pool destination.
  const treasuryLockVault = await initTokenomicsIfMissing(
    h,
    config,
    treasuryState,
    vault,
    hubMint,
    tokenomics,
  );

  fixture = {
    config,
    pot,
    burn,
    treasuryState,
    vault,
    deskCollection,
    opsWallet,
    treasury: h.payer,
    hubMint,
    otcMint,
    usdcMint,
    vaultUsdc,
    otcPot,
    otcVault,
    opsOtc,
    keeperOtc,
    tokenomics,
    treasuryLockVault,
  };
  return fixture;
}

/** Create `airdrop_vault` + `treasury_lock_vault` (plain spl-token, owned by the vault PDA,
 * mint = hubMint) and call `init_tokenomics` if the singleton doesn't already exist. Returns
 * the resulting `treasury_lock_vault` address either way. */
async function initTokenomicsIfMissing(
  h: Harness,
  config: PublicKey,
  treasuryState: PublicKey,
  vault: PublicKey,
  hubMint: PublicKey,
  tokenomics: PublicKey,
): Promise<PublicKey> {
  const existing = await h.program.account.tokenomicsConfig.fetchNullable(tokenomics);
  if (existing) return existing.treasuryLockVault;
  const airdropVault = await createTokenAccount(h, hubMint, vault);
  const treasuryLockVault = await createTokenAccount(h, hubMint, vault);
  await h.program.methods
    .initTokenomics()
    .accountsPartial({
      authority: h.payer.publicKey,
      config,
      treasuryState,
      vault,
      airdropVault,
      treasuryLockVault,
      tokenomics,
    })
    .rpc();
  return treasuryLockVault;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
