// Shared keeper env/RPC bootstrap — every service in `keeper/*/src/index.ts` connects the
// same way (see `.env.example`'s "across all keeper/ services" contract): `HUB_KEEPER_KEYPAIR`
// holds gas money only, never protocol authority (§keeper/README.md's `Config.treasury`
// signer note — a keeper env alone does not grant treasury spend authority).
//
// `TREASURY_KEYPAIR` (optional) — the dedicated `Config.treasury` hot wallet (see
// `scripts/devnet-set-treasury.ts`), separate from both `Config.authority` and every keeper's
// own `HUB_KEEPER_KEYPAIR` gas wallet. When set, `KeeperEnv.treasury` is populated so a
// service *can* co-sign the `has_one = treasury` instructions (`register_treasury_inflow`,
// `record_creator_fee`, `build_lp`, `build_lp_otc_locked`, ...) — resolves the key-custody half
// of that blocker. The instruction-assembly/submission code for each of those flows is a
// separate, not-yet-implemented piece of work; today's `creator-fee`/`lp`/`sweeper` cycles
// still only read state and log the decision even when `treasury` is present.
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
  /** `Config.treasury` co-signer, if `TREASURY_KEYPAIR` is set — see module doc above. */
  treasury?: Keypair;
  dryRun: boolean;
};

/** Loads `HUB_RPC_URL` / `HUB_KEEPER_KEYPAIR` / `HUB_PROGRAM_ID` / optional `TREASURY_KEYPAIR`
 *  per the shared env contract. */
export function loadKeeperEnv(): KeeperEnv {
  const rpcUrl = process.env.HUB_RPC_URL;
  if (!rpcUrl) throw new Error("HUB_RPC_URL is required");
  const keypairPath = process.env.HUB_KEEPER_KEYPAIR;
  if (!keypairPath) throw new Error("HUB_KEEPER_KEYPAIR is required");
  const keeper = loadKeeperKeypair(keypairPath);
  const treasuryPath = process.env.TREASURY_KEYPAIR;
  const treasury = treasuryPath ? loadKeeperKeypair(treasuryPath) : undefined;
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
  const address = process.env.HUB_PROGRAM_ID ?? (HUB_IDL as { address: string }).address;
  const program: HubProgram = new Program({ ...HUB_IDL, address }, provider);
  return { connection, program, keeper, treasury, dryRun: process.env.DRY_RUN === "1" };
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
    `${label} up — program ${env.program.programId.toBase58()} · keeper ${env.keeper.publicKey.toBase58()}` +
      `${env.treasury ? ` · treasury ${env.treasury.publicKey.toBase58()}` : ""}` +
      `${env.dryRun ? " · DRY_RUN" : ""}`,
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
