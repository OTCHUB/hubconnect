// Cluster-agnostic helpers shared by the mainnet genesis-airdrop scripts
// (mainnet-airdrop-snapshot.ts, mainnet-distribute.ts). Deliberately separate from lib/devnet.ts,
// whose `devnetCtx()`/`devnetRpc()` hard-require `HUB_CLUSTER=devnet` and default to a
// devnet-labeled keypair path — nothing here can accidentally pull either in.
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as TOKEN_2022_PROGRAM_ID_STR,
  TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID_STR,
} from "../../sdk/src/constants";
import { HUB_IDL, configPda, type HubProgram } from "../../sdk/src";

export const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ID_STR);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ID_STR);
export const ATA_PROGRAM_ID = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/**
 * OTC-side mainnet addresses (external — not deployed by this repo). Resolved 2026-09-11 from
 * otchub's `src/hub/lib/deployments.ts` registry + user-confirmed live accounts (each verified
 * with `solana account <addr> --url mainnet-beta` before being pinned here — see
 * docs/hubconnect-spec.md §A3.2). Never assume these match devnet's harness mocks.
 */
export const OTC_MINT_MAINNET = new PublicKey("MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump");
export const OTC_PROGRAM_MAINNET = new PublicKey("AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW");
export const OTC_DESK_POT_MAINNET = new PublicKey("BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR");
export const OTC_DESKS_COLLECTION_MAINNET = new PublicKey(
  "D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh",
);
/** M.I.M ETF basket legs (§A5.1, `init_hub_pot`) — Backed Finance xStock Token-2022 mints, live
 *  on mainnet-beta. $OTC (above) is the basket's 4th leg. */
export const CRCLX_MINT_MAINNET = new PublicKey("XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1");
export const NVDAX_MINT_MAINNET = new PublicKey("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
export const SPCXX_MINT_MAINNET = new PublicKey("Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8");

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

/** Shared context for the mainnet one-time protocol-init scripts (config/treasury/tokenomics/
 *  otc-pot/hub-pot). Mirrors `lib/devnet.ts`'s `devnetCtx()` shape but signs with
 *  `HUB_MAINNET_WALLET` and never falls back to a devnet-labeled keypair path. */
export type Ctx = {
  connection: Connection;
  provider: AnchorProvider;
  program: HubProgram;
  payer: Keypair;
  config: PublicKey;
  rpc: string;
};

export async function mainnetCtx(rpcOverride?: string | null): Promise<Ctx> {
  const rpc = mainnetRpc(rpcOverride);
  const connection = new Connection(rpc, "confirmed");
  const payer = loadMainnetKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);
  const [config] = configPda(program.programId);
  const bal = (await connection.getBalance(payer.publicKey)) / 1_000_000_000;
  console.log(
    `rpc ${redactRpc(rpc)} · payer ${payer.publicKey.toBase58()} · ${bal.toFixed(4)} SOL · program ${program.programId.toBase58()}`,
  );
  return { connection, provider, program, payer, config, rpc };
}

export const TOKEN_ACCOUNT_SIZE = 165;

/** spl-token `InitializeAccount3` (ix 18): account · mint · owner (no Rent sysvar needed). Same
 *  instruction layout on both the legacy Token program and Token-2022 — pass `tokenProgramId` to
 *  target whichever one the mint actually belongs to (§otc_pay.rs `is_supported_token_program`
 *  accepts either on-chain). */
export function initializeAccount3(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
) {
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]),
  });
}

/** Fresh plain (non-ATA) spl-token account — needed whenever an owner needs two-or-more accounts
 *  of the same mint (an ATA can only ever represent one), e.g. `vault_hub` and
 *  `treasury_float_vault` both being owned by the `["vault"]` PDA. Mirrors
 *  `devnet-treasury-float.ts`'s `createTokenAccount`. Pass `tokenProgramId =
 *  TOKEN_2022_PROGRAM_ID` for the mainnet OTC/CRCLx/NVDAx/SPCXx basket legs — they're real
 *  Token-2022 mints, unlike devnet's plain-SPL stand-ins. A Token-2022 base account is still
 *  exactly `TOKEN_ACCOUNT_SIZE` (165) bytes as long as the mint has no extensions requiring an
 *  `ImmutableOwner`/extension region on the account itself (true for the basket's xStock mints —
 *  verified via `spl-token account-info` before this script is run against them). */
export async function createPlainTokenAccount(
  ctx: Ctx,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
) {
  const account = Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports: rent,
      space: TOKEN_ACCOUNT_SIZE,
      programId: tokenProgramId,
    }),
    initializeAccount3(account.publicKey, mint, owner, tokenProgramId),
  );
  const sig = await ctx.provider.sendAndConfirm(tx, [ctx.payer, account]);
  return { account: account.publicKey, sig };
}
