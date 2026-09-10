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
//   POST /api/faucet/drip       { wallet } -> one combined starter-kit request, gated by a single
//                                8h-per-wallet cooldown: mints 100,000 $HUB, 100,000 $OTC, and 10
//                                each of CRCLx/NVDAx/SPCXx (the M.I.M ETF basket) to `wallet`,
//                                then mints it an unactivated Mock OTC Desk Core asset (see
//                                mintDeskAsset below). Requires the wallet to already hold native
//                                devnet SOL to pay for its own follow-up txs (activate_tier's step
//                                fee, claim_yield, etc.) — the faucet only ever pays its own gas,
//                                never the recipient's; get devnet SOL from faucet.solana.com.
//   POST /api/faucet/mint-desk  { wallet } -> standalone extra Mock OTC Desk mint (own 8h cooldown,
//                                independent of /drip) for a wallet that already has tokens and
//                                just wants another desk to activate. Same NOT-pre-activated
//                                contract as the desk /drip mints: `activate_tier` hard-requires
//                                the desk's *current owner* to be the signer (`NotDeskOwner`),
//                                and `claim_yield` voids any tier whose owner changed since
//                                activation (anti-wash-trade) — so the faucet can never activate
//                                on a recipient's behalf. The recipient activates from their own
//                                wallet in the dashboard, burning the $HUB `/drip` gave them and
//                                paying the flat SOL step fee themselves — the exact mainnet flow.
//   GET  /api/faucet/status     -> faucet pubkey, balances, live mint addresses
//   anything else               -> env.ASSETS.fetch(request) (the SPA, including /drip)
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
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
import {
  DESK_COOLDOWN_SECONDS,
  DRIP_COOLDOWN_SECONDS,
  DRIP_UNITS,
  IP_LIMIT_PER_HOUR,
} from "./faucet-config";
import { coreCreateV1Ix, mintToIx } from "./faucet-ix";
import { routeCurveRequest, type CurveEnv } from "./bonding-curve";
import { preflightResponse, resolveAllowedOrigin, withCors, type CorsEnv } from "./cors";

interface FaucetKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}
export interface Env extends CurveEnv, CorsEnv {
  ASSETS: AssetFetcher;
  FAUCET_KV: FaucetKV;
  /** JSON secret-key array (`solana-keygen`/`Keypair.generate().secretKey` format). */
  FAUCET_KEY: string;
  HUB_RPC_URL?: string;
  /** Cloudflare Turnstile secret key — pairs with VITE_TURNSTILE_SITE_KEY (web's `.env.devnet`).
   *  Optional: unset skips verification entirely so devnet keeps working pre-provisioning. */
  TURNSTILE_SECRET_KEY?: string;
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
    if (status?.err)
      throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
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
  const connection = new Connection(
    env.HUB_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
  const payer = loadFaucetKeypair(env.FAUCET_KEY);
  const program = createReader(connection, HUB_PROGRAM_ID_PK);
  return { connection, payer, program };
}

/**
 * Cloudflare Turnstile server-side check (siteverify) — the bot-abuse gate in front of
 * `/api/faucet/drip` and `/api/faucet/mint-desk`, independent of the IP/wallet cooldowns below.
 * Returns `null` on success (or when `TURNSTILE_SECRET_KEY` isn't configured yet — skips rather
 * than hard-fails, so devnet keeps working before a widget is provisioned), or an error string.
 */
async function verifyTurnstile(token: unknown, env: Env, request: Request): Promise<string | null> {
  if (!env.TURNSTILE_SECRET_KEY) return null;
  if (typeof token !== "string" || !token) {
    return "verification challenge required — complete the checkbox and try again";
  }
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
  return data?.success ? null : "verification failed — refresh the page and try again";
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
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    // Every client call (faucet.ts + curve.ts in otchub/src/hub/lib) sets `content-type:
    // application/json`, which forces a CORS preflight for *every* method, GET included — so this
    // has to run before any routing below, for every /api/* path, not just the mutating ones.
    const allowedOrigin = resolveAllowedOrigin(request, env);
    if (request.method === "OPTIONS") return preflightResponse(allowedOrigin);

    try {
      if (url.pathname === "/api/faucet/status" && request.method === "GET") {
        return withCors(await handleStatus(env), allowedOrigin);
      }
      if (url.pathname === "/api/faucet/drip" && request.method === "POST") {
        if (!(await checkIpLimit(env, request))) {
          return withCors(json({ error: "too many requests" }, 429), allowedOrigin);
        }
        return withCors(await handleDrip(request, env), allowedOrigin);
      }
      if (url.pathname === "/api/faucet/mint-desk" && request.method === "POST") {
        if (!(await checkIpLimit(env, request))) {
          return withCors(json({ error: "too many requests" }, 429), allowedOrigin);
        }
        return withCors(await handleMintDesk(request, env), allowedOrigin);
      }
      if (url.pathname.startsWith("/api/curve/")) {
        const res = await routeCurveRequest(request, env);
        if (res) return withCors(res, allowedOrigin);
      }
      return withCors(json({ error: "not found" }, 404), allowedOrigin);
    } catch (e) {
      return withCors(json({ error: (e as Error).message }, 500), allowedOrigin);
    }
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
    deskCollection: cfg.deskCollection.equals(PublicKey.default)
      ? null
      : cfg.deskCollection.toBase58(),
    hubPot: hubPot
      ? { crclx: hubPot.crclxMint, nvdax: hubPot.nvdaxMint, spcxx: hubPot.spcxxMint }
      : null,
  });
}

type FaucetCtx = ReturnType<typeof buildCtx>;
type FaucetConfig = { deskCollection: PublicKey; hubMint: PublicKey };

/**
 * Mints one unactivated Mock OTC Desk Core asset, owned by `wallet`, into
 * `cfg.deskCollection` — shared by the combined `/drip` flow and the standalone
 * `/mint-desk` flow so both mint via the exact same real PDA derivation.
 * Not activated here: `wallet` must call `activate_tier` itself from the dashboard.
 */
async function mintDeskAsset(ctx: FaucetCtx, cfg: FaucetConfig, wallet: PublicKey) {
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

  return {
    asset: asset.publicKey.toBase58(),
    deskNumber: n,
    collection: cfg.deskCollection.toBase58(),
    activated: false as const,
    signature: sig,
    explorer: explorerTx(sig),
  };
}

/**
 * §Faucet starter kit — one combined request, one 8h-per-wallet cooldown: 100,000 $HUB,
 * 100,000 $OTC, 10 each of CRCLx/NVDAx/SPCXx (the M.I.M ETF basket "stock" mints), and 1
 * unactivated Mock OTC Desk NFT, all sent/minted to `wallet`. The wallet still needs its own
 * native devnet SOL to pay for its follow-up txs (activate_tier's step fee, claim_yield, etc.)
 * — the faucet only ever covers its own gas, never the recipient's.
 */
async function handleDrip(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  if (!wallet) return json({ error: "wallet must be a base58 Solana public key" }, 400);
  const turnstileErr = await verifyTurnstile(body?.turnstileToken, env, request);
  if (turnstileErr) return json({ error: turnstileErr }, 403);

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
  if (cfg.deskCollection.equals(PublicKey.default)) {
    return json({ error: "Config.desk_collection not set on this cluster yet" }, 503);
  }

  const mints: [keyof typeof DRIP_UNITS, PublicKey][] = [
    ["hub", cfg.hubMint],
    ["otc", cfg.otcMint],
    ["crclx", new PublicKey(hubPot.crclxMint)],
    ["nvdax", new PublicKey(hubPot.nvdaxMint)],
    ["spcxx", new PublicKey(hubPot.spcxxMint)],
  ];

  const infos = await ctx.connection.getMultipleAccountsInfo(mints.map(([, m]) => m));
  for (let i = 0; i < mints.length; i++) {
    const [label, mint] = mints[i];
    const info = infos[i];
    if (!info) return json({ error: `${label} mint not found on-chain` }, 503);
    const auth = parseMint(mint, info.data).mintAuthority;
    if (auth !== ctx.payer.publicKey.toBase58()) {
      return json(
        {
          error: `faucet is not mint authority for ${label} — run scripts/devnet-faucet-authority.ts`,
        },
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

  // Separate tx (fresh blockhash, own signer set) rather than packing into the mint tx above —
  // keeps each transaction well under the size/instruction limits and lets either step's error
  // surface on its own instead of guessing which of 12+ instructions in one tx failed.
  const desk = await mintDeskAsset(ctx, cfg, wallet);

  await env.FAUCET_KV.put(rlKey, String(Date.now()), { expirationTtl: DRIP_COOLDOWN_SECONDS });
  return json({
    signature: sig,
    explorer: explorerTx(sig),
    wallet: wallet.toBase58(),
    amounts: Object.fromEntries(
      mints.map(([label]) => [label, (DRIP_UNITS[label] / 1_000_000n).toString()]),
    ),
    desk,
  });
}

/** Standalone extra Mock OTC Desk mint — own 8h cooldown, independent of `/drip`, for a wallet
 *  that already holds tokens and just wants another desk to activate. */
async function handleMintDesk(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  if (!wallet) return json({ error: "wallet must be a base58 Solana public key" }, 400);
  const turnstileErr = await verifyTurnstile(body?.turnstileToken, env, request);
  if (turnstileErr) return json({ error: turnstileErr }, 403);

  const rlKey = `desk:${wallet.toBase58()}`;
  if (await env.FAUCET_KV.get(rlKey)) {
    return json(
      { error: `already minted a mock desk in the last ${DESK_COOLDOWN_SECONDS / 3600}h` },
      429,
    );
  }

  const ctx = buildCtx(env);
  const [configKey] = configPda(HUB_PROGRAM_ID_PK);
  const cfg = await ctx.program.account.config.fetch(configKey);
  if (cfg.deskCollection.equals(PublicKey.default)) {
    return json({ error: "Config.desk_collection not set on this cluster yet" }, 503);
  }

  const desk = await mintDeskAsset(ctx, cfg, wallet);
  await env.FAUCET_KV.put(rlKey, String(Date.now()), { expirationTtl: DESK_COOLDOWN_SECONDS });
  return json(desk);
}
