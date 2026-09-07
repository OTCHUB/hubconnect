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
  HUB_IDL,
  burnPda,
  configPda,
  epochPda,
  fetchDeskTier,
  fetchOwnedDesks,
  potPda,
  tierPda,
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
export type U64Field = "lpTargetSolLamports" | "epochDurationSecs";
export type ConfigValueArg =
  | { pubkey: PublicKey }
  | { u16: number }
  | { u64: number | bigint }
  | { bool: boolean }
  | { i64: number | bigint };

/**
 * `update_config(field, value)` — the single admin entry point for protocol parameters
 * (§B3 #9). Signer must be `Config.authority`. Rate fields (burn/ops/consignor bps) apply
 * to epochs finalized after the call; `epochDurationSecs` applies to the next epoch opened
 * by `finalize_epoch`. Returns the signature, or null when the value is already set.
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

export async function chainNow(ctx: Ctx) {
  const slot = await ctx.connection.getSlot("confirmed");
  return (await ctx.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

export async function openEpoch(ctx: Ctx) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  const [key] = epochPda(ctx.program.programId, cfg.currentEpoch);
  const epoch = await ctx.program.account.epoch.fetch(key);
  return { cfg, idx: cfg.currentEpoch.toNumber(), key, epoch };
}

/**
 * Close the open epoch: wait for `end_ts`, then `finalize_epoch` (permissionless keeper call).
 * Epochs are schedule-aligned (`next.start = prev.end`), so after an idle stretch the next
 * epoch would already be over. To avoid a chain of catch-up finalizes (one Epoch account each)
 * the duration is set so the next epoch ends `nextLenSecs` from now, then restored.
 */
export async function settleEpoch(ctx: Ctx, nextLenSecs = DEVNET_EPOCH_SECS) {
  const { cfg, idx, epoch } = await openEpoch(ctx);
  const now = await chainNow(ctx);
  const end = epoch.endTs.toNumber();
  if (now < end) {
    console.log(`epoch #${idx} ends in ${end - now}s — waiting`);
    await sleep((end - now + 3) * 1000);
  }
  const catchUp = (await chainNow(ctx)) + nextLenSecs - end;
  const baseline = cfg.epochDurationSecs.toNumber();
  if (catchUp > baseline + 5) await setConfigValue(ctx, "epochDurationSecs", { u64: catchUp });

  const [nextEpoch] = epochPda(ctx.program.programId, idx + 1);
  const [pot] = potPda(ctx.program.programId);
  const [burn] = burnPda(ctx.program.programId);
  const [key] = epochPda(ctx.program.programId, idx);
  const sig = await ctx.program.methods
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
  if (catchUp > baseline + 5) {
    await setConfigValue(ctx, "epochDurationSecs", { u64: nextLenSecs });
  }
  const closed = await ctx.program.account.epoch.fetch(key);
  console.log(
    `finalized epoch #${idx}: inflow ${sol(closed.inflowLamports)} · burn-pending ${sol(closed.burnPendingLamports)} · distributed ${sol(closed.distributedLamports)} · Σw ${closed.totalWeightBp.toString()} bp  (${sig})`,
  );
  return { idx, epoch: closed, sig };
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

/**
 * `claim_yield` for every owned active tier that has not yet claimed `upTo` (sequential per
 * desk from `next_claim_epoch`). Batches 5 claims per transaction. Returns lamports per asset.
 */
export async function claimAllOwned(ctx: Ctx, upTo: number) {
  const desks = await ownedTieredDesks(ctx);
  const [pot] = potPda(ctx.program.programId);
  const ixs: TransactionInstruction[] = [];
  const plan: { asset: PublicKey; epoch: number }[] = [];
  for (const { asset, tier } of desks) {
    for (let e = tier.nextClaimEpoch; e <= upTo; e++) {
      const [epoch] = epochPda(ctx.program.programId, e);
      const [deskTier] = tierPda(ctx.program.programId, asset);
      ixs.push(
        await ctx.program.methods
          .claimYield(new BN(e))
          .accountsPartial({
            claimer: ctx.payer.publicKey,
            deskAsset: asset,
            config: ctx.config,
            deskTier,
            epoch,
            pot,
          })
          .instruction(),
      );
      plan.push({ asset, epoch: e });
    }
  }
  const before = await ctx.connection.getBalance(ctx.payer.publicKey);
  for (let i = 0; i < ixs.length; i += 5) await sendIxs(ctx, ixs.slice(i, i + 5));
  const after = await ctx.connection.getBalance(ctx.payer.publicKey);
  return { claims: plan.length, desks: desks.length, received: after - before };
}

export const sol = (l: BN | number | bigint) =>
  `${(Number(l.toString()) / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
/** Devnet epoch length used by the operator scripts (mainnet: 24h). */
export const DEVNET_EPOCH_SECS = Number(process.env.HUB_DEVNET_EPOCH_SECS || 120);

export const explorer = (sigOrAddr: string, kind: "tx" | "address" = "address") =>
  `https://explorer.solana.com/${kind}/${sigOrAddr}?cluster=devnet`;
