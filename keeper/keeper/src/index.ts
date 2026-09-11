// §B4 epoch keeper + buyback-burn — permissionless: closes the open round the moment its
// inflow reaches `Config.min_pot_threshold_lamports`, fronting nothing but its own tx fee (the
// 90/5/2.5/2.5 split and the SOL→$HUB buyback-burn swap are funded entirely from the pot/vault,
// synchronously inside `finalize_epoch` itself — no separate burn/record_burn step). See
// `keeper/README.md` for the env contract and gas/gate watermarks this loop enforces every cycle.
import "dotenv/config";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import {
  BPS,
  HUB_IDL,
  JUPITER_PROGRAM_ID,
  RAYDIUM_CP_SWAP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  burnPda,
  canFinalize,
  configPda,
  effectiveInflowLamports,
  epochPda,
  lamportsToThreshold,
  otcPotPda,
  potPda,
  roundProgress,
  toConfigView,
  toEpochView,
  treasuryPda,
  vaultPda,
  type HubProgram,
} from "../../../sdk/src";
import { fetchWsolToHubRoute } from "./jupiter";
import { alreadySent, appendJournal } from "./journal";

export {
  checkGasFloat,
  KEEPER_HARD_MIN_LAMPORTS,
  KEEPER_DRIP_TRIGGER_LAMPORTS,
  KEEPER_TARGET_CEILING_LAMPORTS,
  type GasFloatCheck,
} from "../../shared/src/gas";
export {
  checkOperationalGate,
  type ConfigPauseSnapshot,
  type OperationalGateInputs,
  type OperationalGateResult,
} from "../../shared/src/gate";
export { fetchWsolToHubRoute } from "./jupiter";

import { checkGasFloat } from "../../shared/src/gas";
import { checkOperationalGate } from "../../shared/src/gate";
import { isMintAuthoritySealed } from "../../shared/src/mint";

const expand = (p: string) => p.replace(/^~/, os.homedir());

function loadKeeperKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expand(p), "utf8"))));
}

export type KeeperEnv = {
  connection: Connection;
  program: HubProgram;
  keeper: Keypair;
  dryRun: boolean;
  jupiterApiBase?: string;
  jupiterApiKey?: string;
  slippageBps: number;
  maxAccounts: number;
  /** Address Lookup Table holding `finalize_epoch`'s + hop2's fixed (never-epoch-varying, never
   * Jupiter-route) accounts — see `scripts/mainnet-create-epoch-alt.ts`. Without it, `keeper`+
   * `epoch`/`nextEpoch` + those ~22 fixed accounts + hop1's Jupiter route accounts as static keys
   * overflow the legacy 1232-byte transaction limit ("Transaction too large"). Optional so devnet
   * (which never got its own table, and only ever runs `DRY_RUN=1` — never reaches the size
   * limit) keeps using a plain legacy transaction unchanged. */
  epochAlt?: PublicKey;
};

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
  return {
    connection,
    program,
    keeper,
    dryRun: process.env.DRY_RUN === "1",
    jupiterApiBase: process.env.JUPITER_API_BASE,
    jupiterApiKey: process.env.JUPITER_API_KEY,
    slippageBps: Number(process.env.HUB_SWAP_SLIPPAGE_BPS ?? 100),
    maxAccounts: Number(process.env.HUB_SWAP_MAX_ACCOUNTS ?? 32),
    epochAlt: process.env.HUB_EPOCH_ALT ? new PublicKey(process.env.HUB_EPOCH_ALT) : undefined,
  };
}

/** One keeper cycle: gate checks → readiness check → (optional) Jupiter route → submit.
 *  Never throws on an expected "nothing to do"/gate-refused outcome — only on unexpected RPC/
 *  program errors, which the caller logs and survives so the loop keeps running. */
export async function runCycle(env: KeeperEnv): Promise<void> {
  const { connection, program, keeper } = env;
  const id = program.programId;

  const balance = await connection.getBalance(keeper.publicKey);
  const gas = checkGasFloat(balance);
  if (!gas.ok) return void console.warn(`[gate] ${gas.reason}`);
  if (gas.requestDripLamports > 0) {
    console.warn(
      `[gas] below drip trigger — requesting a ${gas.requestDripLamports / 1e9} SOL top-up from ops_wallet`,
    );
  }

  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const [epochKey] = epochPda(id, config.currentEpoch);
  const epoch = toEpochView(await program.account.epoch.fetch(epochKey));

  const hubMint = new PublicKey(config.hubMint);
  const hubMintSealed = await isMintAuthoritySealed(connection, hubMint);
  const gate = checkOperationalGate({ config: { paused: config.paused }, hubMintSealed });
  if (!gate.ok) return void console.warn(`[gate] ${gate.reason}`);

  if (!canFinalize(epoch, config)) {
    const pct = (roundProgress(epoch, config) * 100).toFixed(1);
    console.log(
      `[epoch ${config.currentEpoch}] not ready — ${pct}% of threshold, ${lamportsToThreshold(epoch, config) / 1e9} SOL short`,
    );
    return;
  }
  if (alreadySent(config.currentEpoch)) {
    return void console.warn(
      `[epoch ${config.currentEpoch}] already submitted this run — skipping`,
    );
  }

  const [treasuryKey] = treasuryPda(id);
  const treasury = await program.account.treasuryState.fetch(treasuryKey);
  if (treasury.vaultHub.equals(PublicKey.default)) {
    return void console.error(
      "[gate] TreasuryState.vault_hub unset — run init_treasury_float before the keeper can run",
    );
  }

  const inflow = effectiveInflowLamports(epoch, config);
  const burn = Math.floor((inflow * config.burnPctBp) / BPS);
  const lp = Math.floor((inflow * config.lpPctBp) / BPS);
  const float = Math.floor((inflow * config.treasuryFloatPctBp) / BPS);
  const swapTotal = burn + lp + float;

  const [vaultKey] = vaultPda(id);
  let minUsdcOut = new BN(0);
  let minHubOut = new BN(0);
  let hop1AccountCount = 0;
  let hop1Data: Buffer = Buffer.alloc(0);
  let remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  let routeLabels: string[] = [];
  let outAmount = "0";

  if (swapTotal > 0) {
    const route = await fetchWsolToHubRoute(
      connection,
      vaultKey,
      hubMint,
      treasury.vaultUsdc,
      treasury.vaultHub,
      BigInt(swapTotal),
      {
        apiBase: env.jupiterApiBase,
        apiKey: env.jupiterApiKey,
        slippageBps: env.slippageBps,
        maxAccounts: env.maxAccounts,
      },
    );
    minUsdcOut = new BN(route.hop1.minOut.toString());
    minHubOut = new BN(route.hop2.minOut.toString());
    hop1AccountCount = route.hop1.accounts.length;
    hop1Data = route.hop1.data;
    remainingAccounts = [...route.hop1.accounts, ...route.hop2.accounts];
    routeLabels = [...route.hop1.routeLabels, ...route.hop2.routeLabels];
    outAmount = route.hop2.outAmount.toString();
  }

  console.log(
    `[epoch ${config.currentEpoch}] finalizing — inflow ${inflow / 1e9} SOL, swap ${swapTotal / 1e9} SOL → USDC → $HUB via [${routeLabels.join(", ") || "n/a"}], min_usdc_out ${minUsdcOut.toString()}, min_hub_out ${minHubOut.toString()}`,
  );

  const journalBase = {
    ts: new Date().toISOString(),
    epochIndex: config.currentEpoch,
    swapTotalLamports: String(swapTotal),
    minUsdcOut: minUsdcOut.toString(),
    minHubOut: minHubOut.toString(),
    outAmount,
    routeLabels,
    dryRun: env.dryRun,
  };

  if (env.dryRun) {
    appendJournal({ ...journalBase, status: "dry-run" });
    return void console.log("[dry-run] not submitting");
  }

  const [nextEpochKey] = epochPda(id, config.currentEpoch + 1);
  const [potKey] = potPda(id);
  const [burnKey] = burnPda(id);
  const [otcPotKey] = otcPotPda(id);

  const builder = program.methods
    .finalizeEpoch(new BN(config.currentEpoch), minUsdcOut, minHubOut, hop1AccountCount, hop1Data)
    .accountsPartial({
      keeper: keeper.publicKey,
      config: configKey,
      epoch: epochKey,
      nextEpoch: nextEpochKey,
      pot: potKey,
      burn: burnKey,
      otcPot: otcPotKey,
      treasuryState: treasuryKey,
      vault: vaultKey,
      hubMint,
      vaultWsol: treasury.vaultWsol,
      vaultUsdc: treasury.vaultUsdc,
      vaultHub: treasury.vaultHub,
      treasuryFloatVault: treasury.treasuryFloatVault,
      tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
      jupiterProgram: new PublicKey(JUPITER_PROGRAM_ID),
      raydiumProgram: new PublicKey(RAYDIUM_CP_SWAP_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts);

  try {
    const sig = env.epochAlt
      ? await sendWithAlt(connection, keeper, builder, env.epochAlt)
      : await builder.rpc();
    appendJournal({ ...journalBase, status: "sent", signature: sig });
    console.log(`[epoch ${config.currentEpoch}] finalized → ${sig}`);
  } catch (e) {
    appendJournal({ ...journalBase, status: "error", error: String((e as Error)?.message ?? e) });
    throw e;
  }
}

/** Builds + sends `builder` as a v0 `VersionedTransaction` resolving `alt`'s entries by lookup
 * instead of embedding them as 32-byte static keys — see `KeeperEnv.epochAlt`'s doc comment for
 * why this is required on mainnet. `alt` covers `finalize_epoch`'s + hop2's fixed accounts only;
 * `keeper` (signer) and hop1's Jupiter route accounts always stay in the static key list (a
 * signer can never be ALT-resolved, and Jupiter's own CPI accounts can't be either — see
 * `scripts/mainnet-create-epoch-alt.ts`'s doc comment). */
async function sendWithAlt(
  connection: Connection,
  keeper: Keypair,
  builder: ReturnType<HubProgram["methods"]["finalizeEpoch"]>,
  alt: PublicKey,
): Promise<string> {
  const lookupTable = await connection.getAddressLookupTable(alt);
  if (!lookupTable.value) throw new Error(`epoch ALT ${alt.toBase58()} not found on-chain`);
  const ix = await builder.instruction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message([lookupTable.value]);
  const tx = new VersionedTransaction(message);
  tx.sign([keeper]);
  const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function main(): Promise<void> {
  const env = loadKeeperEnv();
  console.log(
    `epoch keeper up — program ${env.program.programId.toBase58()} · keeper ${env.keeper.publicKey.toBase58()}${env.dryRun ? " · DRY_RUN" : ""}`,
  );
  const runOnce = process.env.KEEPER_RUN_ONCE === "1";
  const intervalMs = Number(process.env.KEEPER_LOOP_INTERVAL_MS ?? 60_000);
  let stopping = false;
  process.once("SIGINT", () => (stopping = true));
  process.once("SIGTERM", () => (stopping = true));
  do {
    try {
      await runCycle(env);
    } catch (e) {
      console.error("[cycle error]", e);
    }
    if (runOnce) break;
    await sleep(intervalMs);
  } while (!stopping);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
