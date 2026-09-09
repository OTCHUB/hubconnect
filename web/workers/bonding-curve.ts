// Devnet-only virtual bonding-curve simulation, mounted into workers/faucet.ts under
// `/api/curve/*`. Simulates the OTC Launcher's pre-graduation bonding curve for $HUB/SOL using
// a pump.fun-style constant-product virtual AMM: no on-chain curve program exists (or is needed)
// for this — the curve treasury (`CURVE_KEY`, isolated from the faucet + deployer wallets) holds
// the real ≥95% public $HUB float, and the Worker is the sole authority computing/paying out
// trades against KV-persisted virtual reserves.
//
// Trust model — "verify deposit, then pay out" (same pattern as every other worker-signed
// transaction in this repo; no partial-multisig transaction construction):
//   1. Client sends the real leg itself (SOL → curve wallet for a buy; $HUB → curve's $HUB ATA
//      for a sell) as an ordinary single-signer wallet-adapter transaction and confirms it.
//   2. Client calls POST /api/curve/buy or /sell with { wallet, signature }.
//   3. Worker re-derives the deposited amount from the confirmed transaction's balance deltas
//      (never trusts a client-supplied amount), computes the curve's output at the *current*
//      KV state, pays it out in a Worker-signed transaction, updates the virtual reserves, and
//      appends a trade-log entry for the live-activity feed.
// Replay is blocked by recording each consumed deposit signature in KV with a TTL. Concurrent
// trades racing the read-modify-write KV state update is a known, documented limitation
// appropriate for a devnet simulation (not a real on-chain AMM, which serializes via slots).
//
// Routes (all under /api/curve/, wired from faucet.ts's fetch dispatcher):
//   GET  /api/curve/state   -> virtual reserves, real SOL raised / $HUB sold, graduation status
//   GET  /api/curve/trades  -> recent trade log (live-activity feed)
//   POST /api/curve/quote   { side, amount } -> preview output at current state (no funds move)
//   POST /api/curve/buy     { wallet, signature, minHubOut? } -> pays out $HUB for a confirmed SOL deposit
//   POST /api/curve/sell    { wallet, signature, minSolOut? } -> pays out SOL for a confirmed $HUB deposit
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ataPda,
  createAtaIdempotentIx,
  HUB_PROGRAM_ID,
  configPda,
  createReader,
} from "../../sdk/src";
import {
  CURVE_WALLET_MIN_LAMPORTS,
  DEPOSIT_MAX_AGE_SECONDS,
  GRADUATION_RENT_BUFFER_LAMPORTS,
  GRADUATION_TARGET_LAMPORTS,
  HUB_DECIMALS,
  TRADE_LOG_LIMIT,
  TX_REPLAY_TTL_SECONDS,
  VIRTUAL_SOL_LAMPORTS,
} from "./curve-config";
import { transferCheckedIx } from "./curve-ix";
import {
  buildCpSwapInitializeIx,
  CPMM_CREATE_POOL_FEE_LAMPORTS,
  deriveCpSwapPoolKeys,
  syncNativeIx,
  WSOL_MINT,
} from "./raydium-cpswap";

interface CurveKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
export interface CurveEnv {
  CURVE_KV: CurveKV;
  CURVE_KEY: string;
  HUB_RPC_URL?: string;
}

type CurveState = {
  virtualSolLamports: string;
  virtualHubUnits: string;
  realSolRaisedLamports: string;
  realHubSoldUnits: string;
  graduated: boolean;
  poolAddress: string | null;
  graduatedAt: number | null;
  createdAt: number;
};

type Trade = {
  ts: number;
  side: "buy" | "sell";
  wallet: string;
  solLamports: string;
  hubUnits: string;
  signature: string;
  payoutSignature: string;
};

const STATE_KEY = "curve:state";
const TRADES_KEY = "curve:trades";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function loadCurveKeypair(secret: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret.trim())));
}

function buildCtx(env: CurveEnv) {
  const connection = new Connection(
    env.HUB_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
  const curve = loadCurveKeypair(env.CURVE_KEY);
  const program = createReader(connection, new PublicKey(HUB_PROGRAM_ID));
  return { connection, curve, program };
}

async function getHubMint(ctx: ReturnType<typeof buildCtx>): Promise<PublicKey> {
  const [configKey] = configPda(new PublicKey(HUB_PROGRAM_ID));
  const cfg = await ctx.program.account.config.fetch(configKey);
  return cfg.hubMint;
}

/** Lazy-inits KV state on first request: virtual $HUB reserve = the curve wallet's real,
 * on-chain $HUB balance at genesis (the ≥95% public float provisioned by
 * scripts/devnet-fund-curve.ts) — so the curve's price starts consistent with the actual float,
 * never a guessed number. */
async function loadState(env: CurveEnv, ctx: ReturnType<typeof buildCtx>): Promise<CurveState> {
  const raw = await env.CURVE_KV.get(STATE_KEY);
  if (raw) return JSON.parse(raw) as CurveState;

  const hubMint = await getHubMint(ctx);
  const [curveHub] = ataPda(ctx.curve.publicKey, hubMint);
  const bal = await ctx.connection.getTokenAccountBalance(curveHub);
  const state: CurveState = {
    virtualSolLamports: VIRTUAL_SOL_LAMPORTS.toString(),
    virtualHubUnits: bal.value.amount,
    realSolRaisedLamports: "0",
    realHubSoldUnits: "0",
    graduated: false,
    poolAddress: null,
    graduatedAt: null,
    createdAt: Date.now(),
  };
  await env.CURVE_KV.put(STATE_KEY, JSON.stringify(state));
  return state;
}

async function saveState(env: CurveEnv, state: CurveState) {
  await env.CURVE_KV.put(STATE_KEY, JSON.stringify(state));
}

async function pushTrade(env: CurveEnv, trade: Trade) {
  const raw = await env.CURVE_KV.get(TRADES_KEY);
  const trades: Trade[] = raw ? JSON.parse(raw) : [];
  trades.unshift(trade);
  await env.CURVE_KV.put(TRADES_KEY, JSON.stringify(trades.slice(0, TRADE_LOG_LIMIT)));
}

// ---- constant-product curve math (x·y = k, no fee — a devnet simulation, not the real
// launcher's exact fee schedule) --------------------------------------------------------------

/** solIn lamports → $HUB base units out, plus the post-trade virtual reserves. */
function computeBuy(state: CurveState, solInLamports: bigint) {
  const vSol = BigInt(state.virtualSolLamports);
  const vHub = BigInt(state.virtualHubUnits);
  const k = vSol * vHub;
  const newVSol = vSol + solInLamports;
  const newVHub = k / newVSol;
  const hubOut = vHub - newVHub;
  return { hubOut, newVSol, newVHub };
}

/** hubIn base units → SOL lamports out, plus the post-trade virtual reserves. */
function computeSell(state: CurveState, hubInUnits: bigint) {
  const vSol = BigInt(state.virtualSolLamports);
  const vHub = BigInt(state.virtualHubUnits);
  const k = vSol * vHub;
  const newVHub = vHub + hubInUnits;
  const newVSol = k / newVHub;
  const solOut = vSol - newVSol;
  return { solOut, newVSol, newVHub };
}

function progressBp(state: CurveState): number {
  const raised = BigInt(state.realSolRaisedLamports);
  const bp = (raised * 10_000n) / GRADUATION_TARGET_LAMPORTS;
  return bp > 10_000n ? 10_000 : Number(bp);
}

function toStatePayload(
  state: CurveState,
  curveWallet: PublicKey,
  curveHub: PublicKey,
  hubMint: PublicKey,
) {
  const vSol = BigInt(state.virtualSolLamports);
  const vHub = BigInt(state.virtualHubUnits);
  return {
    ...state,
    progressBp: progressBp(state),
    graduationTargetLamports: GRADUATION_TARGET_LAMPORTS.toString(),
    curveWallet: curveWallet.toBase58(),
    curveHubAta: curveHub.toBase58(),
    hubMint: hubMint.toBase58(),
    // Spot price in lamports per whole $HUB (vSol/vHub is lamports per base unit; scale up by
    // 10^HUB_DECIMALS for a human-friendly "lamports per token" figure the UI can convert to SOL/USD).
    spotPriceLamportsPerHub:
      vHub === 0n ? "0" : ((vSol * 10n ** BigInt(HUB_DECIMALS)) / vHub).toString(),
  };
}

// ---- confirmed-transaction verification (never trust a client-supplied amount) ---------------

async function fetchConfirmedTx(connection: Connection, signature: string) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error("deposit transaction not found (not yet confirmed, or wrong cluster)");
  if (tx.meta?.err)
    throw new Error(`deposit transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`);
  if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > DEPOSIT_MAX_AGE_SECONDS) {
    throw new Error("deposit transaction too old to redeem — send a fresh one");
  }
  return tx;
}

function accountKeyIndex(
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  pk: PublicKey,
): number {
  const keys = tx!.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx!.meta?.loadedAddresses ?? undefined,
  });
  for (let i = 0; i < keys.length; i++) if (keys.get(i)?.equals(pk)) return i;
  return -1;
}

/** Net lamports the given account gained in this transaction (0 if untouched/not found). */
function solDelta(tx: Awaited<ReturnType<Connection["getTransaction"]>>, pk: PublicKey): bigint {
  const idx = accountKeyIndex(tx, pk);
  if (idx < 0 || !tx!.meta) return 0n;
  return BigInt(tx!.meta.postBalances[idx]) - BigInt(tx!.meta.preBalances[idx]);
}

/** Net $HUB base units the given token account gained in this transaction (0 if untouched). */
function hubDelta(
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  tokenAccount: PublicKey,
  mint: PublicKey,
): bigint {
  const idx = accountKeyIndex(tx, tokenAccount);
  if (idx < 0 || !tx!.meta) return 0n;
  const mintStr = mint.toBase58();
  const pre = (tx!.meta.preTokenBalances ?? []).find(
    (b) => b.accountIndex === idx && b.mint === mintStr,
  );
  const post = (tx!.meta.postTokenBalances ?? []).find(
    (b) => b.accountIndex === idx && b.mint === mintStr,
  );
  const preAmt = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
  const postAmt = post ? BigInt(post.uiTokenAmount.amount) : 0n;
  return postAmt - preAmt;
}

async function alreadyConsumed(env: CurveEnv, signature: string): Promise<boolean> {
  return (await env.CURVE_KV.get(`curve:tx:${signature}`)) !== null;
}
async function markConsumed(env: CurveEnv, signature: string) {
  await env.CURVE_KV.put(`curve:tx:${signature}`, "1", { expirationTtl: TX_REPLAY_TTL_SECONDS });
}

async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parsePubkey(v: unknown): PublicKey | null {
  if (typeof v !== "string") return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ---- graduation: migrate the curve's real SOL + remaining $HUB into a live devnet Raydium
// CP-Swap pool once realSolRaisedLamports crosses GRADUATION_TARGET_LAMPORTS -------------------

/** Wraps the curve wallet's spendable SOL into its WSOL ATA and calls Raydium CP-Swap's
 * `initialize`, seeding the pool with that SOL + the curve's entire remaining $HUB balance.
 * Never throws — returns `null` (and logs) on any failure so the caller can defer/retry rather
 * than get stuck with `graduated: true` and no pool. Aborts *before* sending anything if the
 * curve wallet can't cover Raydium's create_pool_fee + new-account rent + a tx-fee buffer. */
async function attemptGraduation(
  env: CurveEnv,
  ctx: ReturnType<typeof buildCtx>,
  hubMint: PublicKey,
): Promise<{ poolAddress: string } | null> {
  try {
    const keys = deriveCpSwapPoolKeys(hubMint);
    const [curveHub] = ataPda(ctx.curve.publicKey, hubMint);
    const [curveWsol] = ataPda(ctx.curve.publicKey, WSOL_MINT);
    const [hubBalRaw, wsolRentExempt, solBalRaw] = await Promise.all([
      ctx.connection
        .getTokenAccountBalance(curveHub)
        .then((b) => BigInt(b.value.amount))
        .catch(() => 0n),
      ctx.connection.getMinimumBalanceForRentExemption(165),
      ctx.connection.getBalance(ctx.curve.publicKey),
    ]);
    const reserve =
      CURVE_WALLET_MIN_LAMPORTS + CPMM_CREATE_POOL_FEE_LAMPORTS + GRADUATION_RENT_BUFFER_LAMPORTS;
    const solForPool = BigInt(solBalRaw) - reserve - BigInt(wsolRentExempt);
    if (solForPool <= 0n || hubBalRaw <= 0n) {
      console.error(
        `graduation deferred: curve wallet underfunded (solBal=${solBalRaw}, hubBal=${hubBalRaw})`,
      );
      return null;
    }

    const isHub0 = keys.token0Mint.equals(hubMint);
    const [creatorLpToken] = ataPda(ctx.curve.publicKey, keys.lpMint);
    const tx = new Transaction().add(
      createAtaIdempotentIx(ctx.curve.publicKey, ctx.curve.publicKey, WSOL_MINT),
      SystemProgram.transfer({
        fromPubkey: ctx.curve.publicKey,
        toPubkey: curveWsol,
        lamports: BigInt(wsolRentExempt) + solForPool,
      }),
      syncNativeIx(curveWsol),
      buildCpSwapInitializeIx({
        creator: ctx.curve.publicKey,
        keys,
        creatorToken0: isHub0 ? curveHub : curveWsol,
        creatorToken1: isHub0 ? curveWsol : curveHub,
        creatorLpToken,
        initAmount0: isHub0 ? hubBalRaw : solForPool,
        initAmount1: isHub0 ? solForPool : hubBalRaw,
      }),
    );
    const bh = await ctx.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = ctx.curve.publicKey;
    tx.sign(ctx.curve);
    const sig = await ctx.connection.sendRawTransaction(tx.serialize());
    await ctx.connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`curve graduated -> pool ${keys.poolState.toBase58()} · ${explorerTx(sig)}`);
    return { poolAddress: keys.poolState.toBase58() };
  } catch (e) {
    console.error(`graduation attempt failed: ${(e as Error).message}`);
    return null;
  }
}

/** Runs graduation once per state transition and persists the result — shared by the
 * threshold-crossing buy and the lazy retry in `handleState`. */
async function maybeGraduate(
  env: CurveEnv,
  ctx: ReturnType<typeof buildCtx>,
  hubMint: PublicKey,
  state: CurveState,
): Promise<CurveState> {
  if (!state.graduated || state.poolAddress) return state;
  const result = await attemptGraduation(env, ctx, hubMint);
  if (!result) return state;
  const next: CurveState = { ...state, poolAddress: result.poolAddress };
  await saveState(env, next);
  return next;
}

// ---- handlers ----------------------------------------------------------------------------

async function handleState(env: CurveEnv): Promise<Response> {
  const ctx = buildCtx(env);
  const [state, hubMint] = await Promise.all([loadState(env, ctx), getHubMint(ctx)]);
  // Self-healing retry: a prior graduation attempt (from handleBuy) may have failed (e.g. the
  // curve wallet was momentarily underfunded) — GET /api/curve/state is polled every few seconds
  // by the dashboard, so simply retrying here means the UI's "pool migration in progress" state
  // resolves itself without any admin intervention.
  const resolved = await maybeGraduate(env, ctx, hubMint, state);
  const [curveHub] = ataPda(ctx.curve.publicKey, hubMint);
  return json(toStatePayload(resolved, ctx.curve.publicKey, curveHub, hubMint));
}

async function handleTrades(env: CurveEnv): Promise<Response> {
  const raw = await env.CURVE_KV.get(TRADES_KEY);
  return json({ trades: raw ? JSON.parse(raw) : [] });
}

async function handleQuote(request: Request, env: CurveEnv): Promise<Response> {
  const body = await safeJson(request);
  const side = body?.side === "sell" ? "sell" : body?.side === "buy" ? "buy" : null;
  const amount = typeof body?.amount === "string" ? BigInt(body.amount) : null;
  if (!side || amount === null || amount <= 0n) {
    return json({ error: "body must be { side: 'buy'|'sell', amount: string > 0 }" }, 400);
  }
  const ctx = buildCtx(env);
  const state = await loadState(env, ctx);
  if (state.graduated)
    return json({ error: "curve has graduated — trade on the AMM pool", graduated: true }, 409);
  if (side === "buy") {
    const { hubOut } = computeBuy(state, amount);
    return json({ side, solIn: amount.toString(), hubOut: hubOut.toString() });
  }
  const { solOut } = computeSell(state, amount);
  return json({ side, hubIn: amount.toString(), solOut: solOut.toString() });
}

async function handleBuy(request: Request, env: CurveEnv): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  const signature = typeof body?.signature === "string" ? body.signature : null;
  const minHubOut = typeof body?.minHubOut === "string" ? BigInt(body.minHubOut) : 0n;
  if (!wallet || !signature) return json({ error: "body must be { wallet, signature }" }, 400);
  if (await alreadyConsumed(env, signature))
    return json({ error: "deposit already redeemed" }, 409);

  const ctx = buildCtx(env);
  const state = await loadState(env, ctx);
  if (state.graduated)
    return json({ error: "curve has graduated — trade on the AMM pool", graduated: true }, 409);

  const tx = await fetchConfirmedTx(ctx.connection, signature);
  const solIn = solDelta(tx, ctx.curve.publicKey);
  if (solIn <= 0n)
    return json({ error: "no SOL deposit to the curve wallet found in that transaction" }, 400);

  const { hubOut, newVSol, newVHub } = computeBuy(state, solIn);
  if (hubOut < minHubOut) {
    return json(
      {
        error: `slippage: would receive ${hubOut} < minHubOut ${minHubOut} — deposit still valid, retry`,
      },
      409,
    );
  }
  const hubMint = await getHubMint(ctx);
  const [curveHub] = ataPda(ctx.curve.publicKey, hubMint);
  const [buyerHub] = ataPda(wallet, hubMint);
  const payoutTx = new Transaction().add(
    createAtaIdempotentIx(ctx.curve.publicKey, wallet, hubMint),
    transferCheckedIx(curveHub, hubMint, buyerHub, ctx.curve.publicKey, hubOut, HUB_DECIMALS),
  );
  const bh = await ctx.connection.getLatestBlockhash("confirmed");
  payoutTx.recentBlockhash = bh.blockhash;
  payoutTx.feePayer = ctx.curve.publicKey;
  payoutTx.sign(ctx.curve);
  const payoutSig = await ctx.connection.sendRawTransaction(payoutTx.serialize());
  await ctx.connection.confirmTransaction({ signature: payoutSig, ...bh }, "confirmed");

  let nextState: CurveState = {
    ...state,
    virtualSolLamports: newVSol.toString(),
    virtualHubUnits: newVHub.toString(),
    realSolRaisedLamports: (BigInt(state.realSolRaisedLamports) + solIn).toString(),
    realHubSoldUnits: (BigInt(state.realHubSoldUnits) + hubOut).toString(),
  };
  nextState.graduated = BigInt(nextState.realSolRaisedLamports) >= GRADUATION_TARGET_LAMPORTS;
  if (nextState.graduated && !nextState.graduatedAt) nextState.graduatedAt = Date.now();
  await saveState(env, nextState);
  nextState = await maybeGraduate(env, ctx, hubMint, nextState);
  await pushTrade(env, {
    ts: Date.now(),
    side: "buy",
    wallet: wallet.toBase58(),
    solLamports: solIn.toString(),
    hubUnits: hubOut.toString(),
    signature,
    payoutSignature: payoutSig,
  });
  await markConsumed(env, signature);

  return json({
    side: "buy",
    solIn: solIn.toString(),
    hubOut: hubOut.toString(),
    signature: payoutSig,
    explorer: explorerTx(payoutSig),
    graduated: nextState.graduated,
    progressBp: progressBp(nextState),
  });
}

async function handleSell(request: Request, env: CurveEnv): Promise<Response> {
  const body = await safeJson(request);
  const wallet = parsePubkey(body?.wallet);
  const signature = typeof body?.signature === "string" ? body.signature : null;
  const minSolOut = typeof body?.minSolOut === "string" ? BigInt(body.minSolOut) : 0n;
  if (!wallet || !signature) return json({ error: "body must be { wallet, signature }" }, 400);
  if (await alreadyConsumed(env, signature))
    return json({ error: "deposit already redeemed" }, 409);

  const ctx = buildCtx(env);
  const state = await loadState(env, ctx);
  if (state.graduated)
    return json({ error: "curve has graduated — trade on the AMM pool", graduated: true }, 409);

  const hubMint = await getHubMint(ctx);
  const [curveHub] = ataPda(ctx.curve.publicKey, hubMint);
  const tx = await fetchConfirmedTx(ctx.connection, signature);
  const hubIn = hubDelta(tx, curveHub, hubMint);
  if (hubIn <= 0n)
    return json({ error: "no $HUB deposit to the curve's vault found in that transaction" }, 400);

  const { solOut, newVSol, newVHub } = computeSell(state, hubIn);
  if (solOut < minSolOut) {
    return json(
      {
        error: `slippage: would receive ${solOut} < minSolOut ${minSolOut} — deposit still valid, retry`,
      },
      409,
    );
  }
  const curveBal = BigInt(await ctx.connection.getBalance(ctx.curve.publicKey));
  const spendable =
    curveBal > CURVE_WALLET_MIN_LAMPORTS ? curveBal - CURVE_WALLET_MIN_LAMPORTS : 0n;
  if (solOut > spendable) {
    return json(
      { error: "curve has insufficient SOL liquidity to pay this sell out right now" },
      503,
    );
  }

  const payoutTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: ctx.curve.publicKey, toPubkey: wallet, lamports: solOut }),
  );
  const bh = await ctx.connection.getLatestBlockhash("confirmed");
  payoutTx.recentBlockhash = bh.blockhash;
  payoutTx.feePayer = ctx.curve.publicKey;
  payoutTx.sign(ctx.curve);
  const payoutSig = await ctx.connection.sendRawTransaction(payoutTx.serialize());
  await ctx.connection.confirmTransaction({ signature: payoutSig, ...bh }, "confirmed");

  const nextState: CurveState = {
    ...state,
    virtualSolLamports: newVSol.toString(),
    virtualHubUnits: newVHub.toString(),
    realSolRaisedLamports: (BigInt(state.realSolRaisedLamports) - solOut).toString(),
    realHubSoldUnits: (BigInt(state.realHubSoldUnits) - hubIn).toString(),
  };
  await saveState(env, nextState);
  await pushTrade(env, {
    ts: Date.now(),
    side: "sell",
    wallet: wallet.toBase58(),
    solLamports: solOut.toString(),
    hubUnits: hubIn.toString(),
    signature,
    payoutSignature: payoutSig,
  });
  await markConsumed(env, signature);

  return json({
    side: "sell",
    hubIn: hubIn.toString(),
    solOut: solOut.toString(),
    signature: payoutSig,
    explorer: explorerTx(payoutSig),
    graduated: nextState.graduated,
    progressBp: progressBp(nextState),
  });
}

/** Mounted from workers/faucet.ts for every `/api/curve/*` path; returns null for anything it
 * doesn't own so the caller can fall through. */
export async function routeCurveRequest(request: Request, env: CurveEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/curve/state" && request.method === "GET") return handleState(env);
  if (url.pathname === "/api/curve/trades" && request.method === "GET") return handleTrades(env);
  if (url.pathname === "/api/curve/quote" && request.method === "POST")
    return handleQuote(request, env);
  if (url.pathname === "/api/curve/buy" && request.method === "POST")
    return handleBuy(request, env);
  if (url.pathname === "/api/curve/sell" && request.method === "POST")
    return handleSell(request, env);
  if (url.pathname.startsWith("/api/curve/")) return json({ error: "not found" }, 404);
  return null;
}
