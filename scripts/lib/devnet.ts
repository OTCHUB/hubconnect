// Shared context for the devnet operator scripts (mint, mock desks). Signs with the devnet
// deployer (= Config.authority on devnet) and mirrors tests/harness.ts env conventions.
import "dotenv/config";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
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
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, type TransactionBuilder, type Umi } from "@metaplex-foundation/umi";
import { fromWeb3JsInstruction, fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mplCore } from "@metaplex-foundation/mpl-core";
import {
  ACC_SCALE,
  HUB_IDL,
  burnPda,
  configPda,
  epochPda,
  fetchDeskTier,
  fetchOwnedDesks,
  pendingYieldLamports,
  potPda,
  tierPda,
  toConfigView,
  treasuryPda,
  type DeskTierView,
  type HubProgram,
} from "../../sdk/src";

export type Ctx = {
  connection: Connection;
  provider: AnchorProvider;
  program: HubProgram;
  payer: Keypair;
  umi: Umi;
  config: PublicKey;
  rpc: string;
};

const expand = (p: string) => p.replace(/^~/, os.homedir());

export function devnetRpc(): string {
  // .env.example writes HUB_RPC_URL with a ${HELIUS_API_KEY} reference; dotenv does not expand it.
  const url = process.env.HUB_RPC_URL?.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] ?? "");
  if (url) return url;
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com";
}

/** Endpoint without query string — never print the raw RPC (it may carry an API key). */
export const redactRpc = (rpc: string) => rpc.split("?")[0];

export function loadKeypair(
  p = process.env.HUB_WALLET || "~/.config/solana/hubconnect-devnet.json",
) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expand(p), "utf8"))));
}

export async function devnetCtx(
  minSol = Number(process.env.HUB_DEVNET_MIN_SOL || 0.5),
): Promise<Ctx> {
  if ((process.env.HUB_CLUSTER || "devnet") !== "devnet") {
    throw new Error("these scripts are devnet-only (HUB_CLUSTER=devnet)");
  }
  const rpc = devnetRpc();
  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);
  const umi = createUmi(rpc, "confirmed").use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(payer)));

  const bal = (await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
  console.log(
    `rpc ${redactRpc(rpc)} · payer ${payer.publicKey.toBase58()} · ${bal.toFixed(3)} SOL`,
  );
  if (bal < minSol) {
    throw new Error(
      `payer below ${minSol} SOL; airdrop: solana airdrop 2 ${payer.publicKey.toBase58()} -u devnet`,
    );
  }
  const [config] = configPda(program.programId);
  return { connection, provider, program, payer, umi, config, rpc };
}

/** Config fields `update_config` accepts, keyed by the IDL/account field name (camelCase). */
export type PubkeyField =
  | "opsWallet"
  | "deskCollection"
  | "hubMint"
  | "otcMint"
  | "otcDeskPot"
  | "otcProgram"
  | "treasury"
  | "authority";
export type BpsField = "burnPctBp" | "opsPctBp" | "consignorShareBp";
export type BoolField = "consignmentEnabled" | "lpEnabled";
export type U64Field = "lpTargetSolLamports" | "minPotThresholdLamports";
export type ConfigValueArg =
  | { pubkey: PublicKey }
  | { u16: number }
  | { u64: number | bigint }
  | { bool: boolean }
  | { i64: number | bigint };

/**
 * `update_config(field, value)` — the single admin entry point for protocol parameters
 * (§B3 #9). Signer must be `Config.authority`. Rate fields (burn/ops/consignor bps) apply
 * to rounds finalized after the call; `minPotThresholdLamports` gates the next finalize.
 * Returns the signature, or null when the value is already set.
 */
export async function setConfigValue(
  ctx: Ctx,
  field: PubkeyField | BpsField | BoolField | U64Field | "lpPhase2OpenTs",
  value: ConfigValueArg,
) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (!cfg.authority.equals(ctx.payer.publicKey)) {
    throw new Error(`payer is not Config.authority (${cfg.authority.toBase58()})`);
  }
  const current = cfg[field as keyof typeof cfg] as unknown;
  const shown =
    "pubkey" in value
      ? value.pubkey.toBase58()
      : String(Object.values(value)[0] as string | number | bigint | boolean);
  const same =
    "pubkey" in value
      ? (current as PublicKey).equals(value.pubkey)
      : "bool" in value
        ? current === value.bool
        : String(current) === shown;
  if (same) {
    console.log(`config.${field} already ${shown}`);
    return null;
  }
  // Anchor enum encoding: field → `{ opsWallet: {} }`, value → `{ pubkey: [pk] }` / `{ u64: [bn] }`.
  const enc =
    "pubkey" in value
      ? { pubkey: [value.pubkey] }
      : "u16" in value
        ? { u16: [value.u16] }
        : "u64" in value
          ? { u64: [new BN(value.u64.toString())] }
          : "i64" in value
            ? { i64: [new BN(value.i64.toString())] }
            : { bool: [value.bool] };
  const sig = await ctx.program.methods
    .updateConfig({ [field]: {} } as never, enc as never)
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config })
    .rpc();
  console.log(`config.${field} → ${shown}  (${sig})`);
  return sig;
}

/** `update_config` for a Pubkey field; the payer must be Config.authority. */
export const setConfigPubkey = (ctx: Ctx, field: PubkeyField, value: PublicKey) =>
  setConfigValue(ctx, field, { pubkey: value });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];

/** associated-token `CreateIdempotent` (ix 1). */
export function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
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

/** Send several instructions in one transaction signed by the payer (+ extra signers). */
export async function sendIxs(ctx: Ctx, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...ixs);
  return ctx.provider.sendAndConfirm(tx, [ctx.payer, ...signers]);
}

/**
 * Desk owners claim yield in SOL but burn/hold $HUB, so every new desk owner needs a $HUB
 * ATA. Returns a `CreateIdempotent` instruction (payer funds rent) when `owner` has none,
 * or null when it already exists — callers append it to the mint / sweep transaction.
 */
export async function hubAtaIx(ctx: Ctx, owner: PublicKey, hubMint?: PublicKey) {
  const mint = hubMint ?? (await ctx.program.account.config.fetch(ctx.config)).hubMint;
  if (mint.equals(PublicKey.default)) throw new Error("Config.hub_mint unset — run devnet:mint");
  const key = ata(owner, mint);
  const info = await ctx.connection.getAccountInfo(key);
  if (info) return null;
  return createAtaIdempotent(ctx.payer.publicKey, owner, mint);
}

/** Append web3 instructions (e.g. the ATA init) to a umi builder so they land in the same tx. */
export function withIxs(builder: TransactionBuilder, ixs: (TransactionInstruction | null)[]) {
  return ixs
    .filter((ix): ix is TransactionInstruction => ix !== null)
    .reduce(
      (b, ix) =>
        b.add({ instruction: fromWeb3JsInstruction(ix), signers: [], bytesCreatedOnChain: 165 }),
      builder,
    );
}

/** Raw u64 amount of an spl-token account, or null when the account does not exist. */
export async function tokenAmount(ctx: Ctx, tokenAccount: PublicKey) {
  const info = await ctx.connection.getAccountInfo(tokenAccount);
  return info ? info.data.readBigUInt64LE(64) : null;
}

export async function openEpoch(ctx: Ctx) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [key] = epochPda(ctx.program.programId, cfg.currentEpoch);
  const epoch = await ctx.program.account.epoch.fetch(key);
  return { cfg, idx: cfg.currentEpoch.toNumber(), key, epoch };
}

/**
 * Where the open round stands against `min_pot_threshold_lamports`. `effective` is what the
 * program will see at finalize: booked inflow + whole lamports of dust carried from earlier rounds.
 */
export async function roundStatus(ctx: Ctx) {
  const o = await openEpoch(ctx);
  const carry = Number(BigInt(o.cfg.dustScaled.toString()) / ACC_SCALE);
  const effective = o.epoch.inflowLamports.toNumber() + carry;
  const threshold = o.cfg.minPotThresholdLamports.toNumber();
  return {
    ...o,
    carry,
    effective,
    threshold,
    shortfall: Math.max(0, threshold - effective),
    ready: effective >= threshold && !o.cfg.totalWeightBp.isZero(),
  };
}

/** Raw `finalize_epoch(idx)` — no readiness check, so callers can assert the negative case. */
export function finalizeIx(ctx: Ctx, idx: number) {
  const [nextEpoch] = epochPda(ctx.program.programId, idx + 1);
  const [pot] = potPda(ctx.program.programId);
  const [burn] = burnPda(ctx.program.programId);
  const [key] = epochPda(ctx.program.programId, idx);
  return ctx.program.methods
    .finalizeEpoch(new BN(idx))
    .accountsPartial({
      keeper: ctx.payer.publicKey,
      config: ctx.config,
      epoch: key,
      nextEpoch,
      pot,
      burn,
    })
    .rpc();
}

/**
 * Close the open round. Rounds are threshold-gated (OTC desk-pot semantics): `finalize_epoch`
 * succeeds the moment effective inflow ≥ `min_pot_threshold_lamports`; there is nothing to
 * wait for. Throws when the round is not ready — `topUp` (source C) fills the shortfall first.
 */
export async function settleRound(ctx: Ctx, topUp = false) {
  let s = await roundStatus(ctx);
  if (!s.ready && s.shortfall > 0 && topUp) {
    console.log(
      `round #${s.idx} short ${sol(s.shortfall)} of ${sol(s.threshold)} — topping up (C)`,
    );
    await registerInflow(ctx, "c", s.shortfall);
    s = await roundStatus(ctx);
  }
  if (!s.ready) {
    throw new Error(
      s.cfg.totalWeightBp.isZero()
        ? `round #${s.idx}: no active stakers (Σw == 0)`
        : `round #${s.idx} at ${sol(s.effective)} < threshold ${sol(s.threshold)} (short ${sol(s.shortfall)})`,
    );
  }
  const sig = await finalizeIx(ctx, s.idx);
  const closed = await ctx.program.account.epoch.fetch(s.key);
  console.log(
    `finalized round #${s.idx}: inflow ${sol(closed.inflowLamports)} · burn-pending ${sol(closed.burnPendingLamports)} · credited ${sol(closed.distributedLamports)} · Σw ${closed.totalWeightBp.toString()} bp  (${sig})`,
  );
  return { idx: s.idx, epoch: closed, sig };
}

/** Treasury books `lamports` of source B/C/D/F into the open round. */
export async function registerInflow(ctx: Ctx, source: "b" | "c" | "d" | "f", lamports: number) {
  const { key } = await openEpoch(ctx);
  const [pot] = potPda(ctx.program.programId);
  const [treasuryState] = treasuryPda(ctx.program.programId);
  return ctx.program.methods
    .registerTreasuryInflow({ [source]: {} } as never, new BN(lamports))
    .accountsPartial({
      treasury: ctx.payer.publicKey,
      config: ctx.config,
      epoch: key,
      pot,
      treasuryState,
    })
    .rpc();
}

/** Active (non-voided) tiers among the payer's desks in the configured collection. */
export async function ownedTieredDesks(ctx: Ctx) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const assets = await fetchOwnedDesks(ctx.connection, ctx.payer.publicKey, cfg.deskCollection);
  const out: { asset: PublicKey; tier: DeskTierView }[] = [];
  for (const asset of assets) {
    const tier = await fetchDeskTier(ctx.program, asset);
    if (tier && !tier.voided) out.push({ asset, tier });
  }
  return out;
}

/** `claim_yield` instruction for one owned desk (single tx settles every closed round). */
export function claimYieldIx(ctx: Ctx, asset: PublicKey) {
  const [pot] = potPda(ctx.program.programId);
  const [deskTier] = tierPda(ctx.program.programId, asset);
  return ctx.program.methods
    .claimYield()
    .accountsPartial({
      claimer: ctx.payer.publicKey,
      deskAsset: asset,
      config: ctx.config,
      deskTier,
      pot,
    })
    .instruction();
}

/**
 * One `claim_yield` per owned active tier with pending yield — each claim settles every round
 * closed since that desk's stamp. Batches 5 desks per transaction. Returns lamports received.
 */
export async function claimAllOwned(ctx: Ctx) {
  const desks = await ownedTieredDesks(ctx);
  const cfg = toConfigView(await ctx.program.account.config.fetch(ctx.config));
  const due = desks.filter(({ tier }) => pendingYieldLamports(tier, cfg) > 0);
  const ixs: TransactionInstruction[] = [];
  for (const { asset } of due) ixs.push(await claimYieldIx(ctx, asset));
  const before = await ctx.connection.getBalance(ctx.payer.publicKey);
  for (let i = 0; i < ixs.length; i += 5) await sendIxs(ctx, ixs.slice(i, i + 5));
  const after = await ctx.connection.getBalance(ctx.payer.publicKey);
  return { claims: due.length, desks: desks.length, received: after - before };
}

export const sol = (l: BN | number | bigint) =>
  `${(Number(l.toString()) / LAMPORTS_PER_SOL).toFixed(4)} SOL`;

export const explorer = (sigOrAddr: string, kind: "tx" | "address" = "address") =>
  `https://explorer.solana.com/${kind}/${sigOrAddr}?cluster=devnet`;
