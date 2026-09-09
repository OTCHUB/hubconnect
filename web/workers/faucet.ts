// Devnet-exclusive faucet Worker — served only under env.devnet (see ../wrangler.jsonc). Never
// bundled into the mainnet-beta (env.production) Worker, which has no `main` script at all and
// stays a 100% static Cloudflare Pages-style asset deploy.
//
// Deliberately dependency-free beyond @solana/web3.js + the read-only sdk/ (no @anchor-lang/core,
// umi, or mpl-core here): the Worker hand-builds the few instructions it needs (spl-token
// InitializeMint2/MintTo-style raw ixs — same pattern as scripts/devnet-hub-mint.ts — and a
// Metaplex Core CreateV1 with no plugins) so the bundle stays small and free of the dual-module
// hazards that come from web/'s own node_modules diverging from the sdk's. Config/HubPotConfig
// reads use sdk's `createReader` (no wallet), matching every other read path in this repo.
//
// Routes:
//   POST /api/faucet/drip       { wallet } -> mints $HUB/$OTC/CRCLx/OpenAI/Anthropic to `wallet`
//   POST /api/faucet/mint-desk  { wallet } -> mints an unactivated Mock OTC Desk Core asset,
//                                owned by `wallet`, into Config.desk_collection (real PDA
//                                derivation, same Collection/require_desk gate as mainnet).
//                                Deliberately NOT pre-activated: `activate_tier` hard-requires
//                                the desk's *current owner* to be the signer (`NotDeskOwner`),
//                                and `claim_yield` voids any tier whose owner changed since
//                                activation (anti-wash-trade) — so the faucet can never activate
//                                on a recipient's behalf. The recipient activates from their own
//                                wallet in the dashboard, burning the $HUB `/drip` gave them and
//                                paying the flat SOL step fee themselves — the exact mainnet flow.
//   GET  /api/faucet/status     -> faucet pubkey, balances, live mint addresses
//   anything else               -> env.ASSETS.fetch(request) (the SPA, including /drip)
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  HUB_PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  ataPda,
  configPda,
  createAtaIdempotentIx,
  createReader,
  fetchCollectionCounts,
  fetchHubPot,
  parseMint,
} from "../../sdk/src";
import { DESK_COOLDOWN_SECONDS, DRIP_COOLDOWN_SECONDS, DRIP_UNITS, IP_LIMIT_PER_HOUR } from "./faucet-config";
import { coreCreateV1Ix, mintToIx } from "./faucet-ix";

interface FaucetKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}
export interface Env {
  ASSETS: AssetFetcher;
  FAUCET_KV: FaucetKV;
  /** JSON secret-key array (`solana-keygen`/`Keypair.generate().secretKey` format). */
  FAUCET_KEY: string;
  HUB_RPC_URL?: string;
}

const HUB_PROGRAM_ID_PK = new PublicKey(HUB_PROGRAM_ID);
const MPL_CORE_PROGRAM_ID_PK = new PublicKey(MPL_CORE_PROGRAM_ID);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function parsePubkey(v: unknown): PublicKey | null {
  if (typeof v !== "string") return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadFaucetKeypair(secret: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret.trim())));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manual `getSignatureStatuses` polling instead of `Connection.confirmTransaction` — that method
 * defaults to a WebSocket subscription for the "confirmed" commitment, which doesn't reliably
 * signal success inside Cloudflare Workers and can throw a false "block height exceeded" even
 * after the transaction has already landed. Polls until confirmed/finalized, the tx errors, or
 * `lastValidBlockHeight` is passed with no confirmation seen.
 */
async function awaitSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<void> {
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new Error(`signature ${signature} expired before confirming (block height exceeded)`);
    }
    await sleep(1500);
  }
}

function buildCtx(env: Env) {
  const connection = new Connection(env.HUB_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const payer = loadFaucetKeypair(env.FAUCET_KEY);
  const program = createReader(connection, HUB_PROGRAM_ID_PK);
  return { connection, payer, program };
}

/** Cheap secondary abuse guard, independent of the per-wallet cooldowns below. */
async function checkIpLimit(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = `ip:${new Date().toISOString().slice(0, 13)}:${ip}`; // one bucket per hour
  const count = Number((await env.FAUCET_KV.get(key)) ?? "0");
  if (count >= IP_LIMIT_PER_HOUR) return false;
  await env.FAUCET_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/faucet/status" && request.method === "GET") {
        return await handleStatus(env);
      }
      if (url.pathname === "/api/faucet/drip" && request.method === "POST") {
        if (!(await checkIpLimit(env, request))) return json({ error: "too many requests" }, 429);
        return await handleDrip(request, env);
      }
      if (url.pathname === "/api/faucet/mint-desk" && request.method === "POST") {
        if (!(await checkIpLimit(env, request))) return json({ error: "too many requests" }, 429);
        return await handleMintDesk(request, env);
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleStatus(env: Env): Promise<Response> {
  const ctx = buildCtx(env);
  const [configKey] = configPda(HUB_PROGRAM_ID_PK);
  const [cfg, hubPot, solLamports] = await Promise.all([
    ctx.program.account.config.fetch(configKey),
    fetchHubPot(ctx.program),
    ctx.connection.getBalance(ctx.payer.publicKey),
  ]);
  return json({
    faucet: ctx.payer.publicKey.toBase58(),
    solLamports,
    hubMint: cfg.hubMint.toBase58(),
    otcMint: cfg.otcMint.toBase58(),
    deskCollection: cfg.deskCollection.equals(PublicKey.default) ? null : cfg.deskCollection.toBase58(),
    hubPot: hubPot
      ? { crclx: hubPot.crclxMint, openai: hubPot.openaiMint, anthropic: hubPot.anthropicMint }
      : null,
  });
}

async function handleDrip(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  if (!wallet) return json({ error: "wallet must be a base58 Solana public key" }, 400);

  const rlKey = `drip:${wallet.toBase58()}`;
  if (await env.FAUCET_KV.get(rlKey)) {
    return json({ error: `already dripped in the last ${DRIP_COOLDOWN_SECONDS / 3600}h` }, 429);
  }

  const ctx = buildCtx(env);
  const [configKey] = configPda(HUB_PROGRAM_ID_PK);
  const [cfg, hubPot] = await Promise.all([
    ctx.program.account.config.fetch(configKey),
    fetchHubPot(ctx.program),
  ]);
  if (!hubPot) return json({ error: "HubPotConfig not initialized on this cluster yet" }, 503);

  const mints: [keyof typeof DRIP_UNITS, PublicKey][] = [
    ["hub", cfg.hubMint],
    ["otc", cfg.otcMint],
    ["crclx", new PublicKey(hubPot.crclxMint)],
    ["openai", new PublicKey(hubPot.openaiMint)],
    ["anthropic", new PublicKey(hubPot.anthropicMint)],
  ];

  const infos = await ctx.connection.getMultipleAccountsInfo(mints.map(([, m]) => m));
  for (let i = 0; i < mints.length; i++) {
    const [label, mint] = mints[i];
    const info = infos[i];
    if (!info) return json({ error: `${label} mint not found on-chain` }, 503);
    const auth = parseMint(mint, info.data).mintAuthority;
    if (auth !== ctx.payer.publicKey.toBase58()) {
      return json(
        { error: `faucet is not mint authority for ${label} — run scripts/devnet-faucet-authority.ts` },
        503,
      );
    }
  }

  const ixs: TransactionInstruction[] = [];
  for (const [label, mint] of mints) {
    ixs.push(createAtaIdempotentIx(ctx.payer.publicKey, wallet, mint));
    ixs.push(mintToIx(mint, ataPda(wallet, mint)[0], ctx.payer.publicKey, DRIP_UNITS[label]));
  }
  const bh = await ctx.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: ctx.payer.publicKey, recentBlockhash: bh.blockhash }).add(
    ...ixs,
  );
  tx.sign(ctx.payer);
  const sig = await ctx.connection.sendRawTransaction(tx.serialize());
  await awaitSignature(ctx.connection, sig, bh.lastValidBlockHeight);

  await env.FAUCET_KV.put(rlKey, String(Date.now()), { expirationTtl: DRIP_COOLDOWN_SECONDS });
  return json({
    signature: sig,
    explorer: explorerTx(sig),
    wallet: wallet.toBase58(),
    amounts: Object.fromEntries(
      mints.map(([label]) => [label, (DRIP_UNITS[label] / 1_000_000n).toString()]),
    ),
  });
}

async function handleMintDesk(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  if (!wallet) return json({ error: "wallet must be a base58 Solana public key" }, 400);

  const rlKey = `desk:${wallet.toBase58()}`;
  if (await env.FAUCET_KV.get(rlKey)) {
    return json({ error: `already minted a mock desk in the last ${DESK_COOLDOWN_SECONDS / 3600}h` }, 429);
  }

  const ctx = buildCtx(env);
  const [configKey] = configPda(HUB_PROGRAM_ID_PK);
  const cfg = await ctx.program.account.config.fetch(configKey);
  if (cfg.deskCollection.equals(PublicKey.default)) {
    return json({ error: "Config.desk_collection not set on this cluster yet" }, 503);
  }

  // Real PDA-based derivation via fetchCollectionCounts (same Collection numMinted counter the
  // on-chain program itself increments on CreateV1) — the desk number matches what mainnet would
  // assign, not a client-guessed value.
  const counts = await fetchCollectionCounts(ctx.connection, cfg.deskCollection);
  const n = (counts?.numMinted ?? 0) + 1;
  const asset = Keypair.generate();
  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(ctx.payer.publicKey, wallet, cfg.hubMint),
    coreCreateV1Ix({
      programId: MPL_CORE_PROGRAM_ID_PK,
      asset: asset.publicKey,
      collection: cfg.deskCollection,
      authority: ctx.payer.publicKey,
      payer: ctx.payer.publicKey,
      owner: wallet,
      name: `OTC Desk #${n} (faucet)`,
      uri: `https://arweave.net/9IlfJuOo6bR38UV87qxDeOzvKpF6_Gbq18RoQnvqOyw/${n}.json`,
    }),
  ];

  const bh = await ctx.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: ctx.payer.publicKey, recentBlockhash: bh.blockhash }).add(
    ...ixs,
  );
  tx.sign(ctx.payer, asset);
  const sig = await ctx.connection.sendRawTransaction(tx.serialize());
  await awaitSignature(ctx.connection, sig, bh.lastValidBlockHeight);

  await env.FAUCET_KV.put(rlKey, String(Date.now()), { expirationTtl: DESK_COOLDOWN_SECONDS });
  // Not activated here — `wallet` owns the asset and must call activate_tier itself from the
  // dashboard (Accrued stock/yield claiming logic lives in web/src/hub/lib/activate.ts +
  // claim.ts, exercised against this same desk/collection, exactly like a mainnet desk).
  return json({
    asset: asset.publicKey.toBase58(),
    deskNumber: n,
    collection: cfg.deskCollection.toBase58(),
    activated: false,
    signature: sig,
    explorer: explorerTx(sig),
  });
}
