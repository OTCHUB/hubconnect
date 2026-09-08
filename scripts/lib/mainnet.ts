// Cluster-agnostic helpers shared by the mainnet genesis-airdrop scripts
// (mainnet-airdrop-snapshot.ts, mainnet-distribute.ts). Deliberately separate from lib/devnet.ts,
// whose `devnetCtx()`/`devnetRpc()` hard-require `HUB_CLUSTER=devnet` and default to a
// devnet-labeled keypair path — nothing here can accidentally pull either in.
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID_STR } from "../../sdk/src/constants";

export const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ID_STR);
export const ATA_PROGRAM_ID = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

const expand = (p: string) => p.replace(/^~/, os.homedir());

/** Endpoint without query string — never print the raw RPC (it may carry an API key). */
export const redactRpc = (rpc: string) => rpc.split("?")[0];

/** `HUB_MAINNET_RPC_URL` (supports `${HELIUS_API_KEY}` substitution) → Helius mainnet by key →
 * public mainnet-beta as a last resort. `override` (a `--rpc` flag) always wins. */
export function mainnetRpc(override?: string | null): string {
  if (override) return override;
  const url = process.env.HUB_MAINNET_RPC_URL?.replace(
    /\$\{(\w+)\}/g,
    (_, v) => process.env[v] ?? "",
  );
  if (url) return url;
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}

/**
 * Mainnet authority keypair — `HUB_MAINNET_WALLET` only, no devnet-style default path. Refuses to
 * guess: this key controls real $HUB, so a missing env var must fail loudly, not fall back to
 * whatever happens to be at `~/.config/solana/id.json`.
 */
export function loadMainnetKeypair(p = process.env.HUB_MAINNET_WALLET): Keypair {
  if (!p) {
    throw new Error(
      "HUB_MAINNET_WALLET is not set — refusing to guess a mainnet authority keypair path",
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expand(p), "utf8"))));
}

export const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  )[0];

/** associated-token `CreateIdempotent` (ix 1) — safe to include even if the ATA already exists. */
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

/** No `?cluster=` query — mainnet-beta is the explorer's default cluster. */
export const explorer = (sigOrAddr: string, kind: "tx" | "address" = "address") =>
  `https://explorer.solana.com/${kind}/${sigOrAddr}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tiny flag parser shared by both scripts: `--flag value` pairs + bare `--boolean-flag`s. */
export function parseFlags(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  return { get, has };
}
