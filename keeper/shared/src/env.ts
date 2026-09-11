// Shared keeper env/RPC bootstrap — every service in `keeper/*/src/index.ts` connects the
// same way (see `.env.example`'s "across all keeper/ services" contract): `HUB_KEEPER_KEYPAIR`
// holds gas money only, never protocol authority (§keeper/README.md's `Config.treasury`
// signer note — a keeper env alone does not grant treasury spend authority).
import "dotenv/config";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import { HUB_IDL, type HubProgram } from "../../../sdk/src";

const expand = (p: string) => p.replace(/^~/, os.homedir());

export function loadKeeperKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expand(p), "utf8"))));
}

export type KeeperEnv = {
  connection: Connection;
  program: HubProgram;
  keeper: Keypair;
  dryRun: boolean;
};

/** Loads `HUB_RPC_URL` / `HUB_KEEPER_KEYPAIR` / `HUB_PROGRAM_ID` per the shared env contract. */
export function loadKeeperEnv(): KeeperEnv {
  const rpcUrl = process.env.HUB_RPC_URL;
  if (!rpcUrl) throw new Error("HUB_RPC_URL is required");
  const keypairPath = process.env.HUB_KEEPER_KEYPAIR;
  if (!keypairPath) throw new Error("HUB_KEEPER_KEYPAIR is required");
  const keeper = loadKeeperKeypair(keypairPath);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
  const address = process.env.HUB_PROGRAM_ID ?? (HUB_IDL as { address: string }).address;
  const program: HubProgram = new Program({ ...HUB_IDL, address }, provider);
  return { connection, program, keeper, dryRun: process.env.DRY_RUN === "1" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generic run-forever loop shared by every keeper's `main()`: gas/gate checks + on-chain work
 * live in `cycle`, this just owns the interval/signal/error-survival plumbing (identical to
 * `keeper/keeper/src/index.ts`'s `main()`, extracted so the four newer services don't each
 * reimplement it slightly differently).
 */
export async function runForever(
  label: string,
  env: KeeperEnv,
  cycle: (env: KeeperEnv) => Promise<void>,
): Promise<void> {
  console.log(
    `${label} up — program ${env.program.programId.toBase58()} · keeper ${env.keeper.publicKey.toBase58()}${env.dryRun ? " · DRY_RUN" : ""}`,
  );
  const runOnce = process.env.KEEPER_RUN_ONCE === "1";
  const intervalMs = Number(process.env.KEEPER_LOOP_INTERVAL_MS ?? 60_000);
  let stopping = false;
  process.once("SIGINT", () => (stopping = true));
  process.once("SIGTERM", () => (stopping = true));
  do {
    try {
      await cycle(env);
    } catch (e) {
      console.error(`[${label}] cycle error`, e);
    }
    if (runOnce) break;
    await sleep(intervalMs);
  } while (!stopping);
}
