// Desk activate / upgrade (§A4): one tx per desk, paid in SOL (`activate_tier` / `upgrade_tier`,
// flat step fee, 90% pot / 10% ops) or in $OTC (`activate_tier_otc` / `upgrade_tier_otc`) — either
// way, `target_tier` is reached directly in ONE call: a fresh activation into T4 pays the flat
// step fee once, exactly like a fresh T1 activation. The SOL path burns the $HUB tier cost
// directly from the payer's wallet; the $OTC path (§otc_pay.rs, revised) charges the *same* flat
// SOL fee **plus** a live-quoted Jupiter $OTC→$HUB swap that both produces the tier's $HUB burn
// (`min_out = hubCostDeltaUnits`, enforced on-chain via balance-delta) and — at an equal-scaled
// amount injected straight into `OtcPotState.otc_vault` (see `otcPotLeg`) — pays roughly 2× that
// swap's $OTC cost in total. Pricing is no longer a static authority-refreshed rate: the caller
// must fetch a live route (`fetchOtcToHubRoute`) and pass its `otcSwapAmount`/`jupiterData` in.
// Same reliability model as claim.ts: simulate unsigned first, one wallet prompt, send, confirm.
// `upgrade_tier` rejects desks with pending yield, so a `claim_yield` ix is prepended when needed.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type AccountMeta,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  BPS,
  JUPITER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ataPda,
  configPda,
  createAtaIdempotentIx,
  epochPda,
  hubCostDeltaUnits,
  otcPayPda,
  otcPayable,
  otcPotPda,
  potPda,
  tierPda,
  tokenomicsPda,
  type ConfigView,
  type HubProgram,
  type OtcPayView,
  type OtcPotView,
  type TokenomicsView,
} from "@hub-sdk";
import { buildClaimYieldIx } from "./claim";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type PayMethod = "sol" | "otc";
export type TierChangePhase = "build" | "sim" | "sign" | "send" | "confirm";
export type TierChangeResult = { asset: string; ok: boolean; sig?: string; reason?: string };

export type TierQuote = {
  steps: number;
  solLamports: number;
  otcAvailable: boolean;
  otcUnavailableReason?: string;
  /** $HUB base units burned for this call (full tier cost on activation, delta on upgrade). Also
   *  the floor (`minHubOut`) `fetchOtcToHubRoute` must clear for the $OTC path. */
  hubBurnUnits: number;
};

const CU_LIMIT = 300_000;
const CU_PRICE_MICRO = 10_000;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const MAX_TIER = 4;

const JUP_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_BUILD_API = "https://api.jup.ag/swap/v2/build";
/** ExactOut quote → ExactIn build is two separate calls; pad the ExactOut estimate so price drift
 *  between them (plus the build's own slippage) still clears `minHubOut` on the first try. */
const OTC_SWAP_INPUT_BUFFER_BP = 150;
const OTC_SWAP_SLIPPAGE_BPS = 100;

export type OtcSwapRoute = {
  /** $OTC base units the caller must hold; becomes `activate_tier_otc`'s `otc_swap_amount` arg. */
  otcSwapAmount: bigint;
  /** Raw Jupiter route instruction data, passed verbatim as the ix's `jupiter_data` arg. */
  jupiterData: Buffer;
  /** The route's account list, passed verbatim as `ctx.remaining_accounts`. */
  remainingAccounts: AccountMeta[];
  /** Unrounded expected $HUB out, for display. */
  outAmount: bigint;
  routeLabels: string[];
};

function assertTierRange(fromTier: number, toTier: number) {
  if (!Number.isInteger(toTier) || toTier < 1 || toTier > MAX_TIER)
    throw new Error(`target tier must be 1..${MAX_TIER}`);
  if (!Number.isInteger(fromTier) || fromTier < 0 || toTier <= fromTier)
    throw new Error("target tier must be above the current tier");
}

/** Why `otcPayable` is false, for the UI. Pricing is a live Jupiter quote now, not a stored rate
 *  — there's nothing left to go stale, only the on/off switch and whether it was ever initialized. */
export function otcUnavailableReason(p: OtcPayView | null): string | undefined {
  if (!p) return "not initialized on this cluster";
  if (!p.enabled) return "disabled";
  return undefined;
}

/** Side-by-side cost of moving `fromTier → toTier` (fromTier 0 = fresh activation). The $OTC
 *  amount itself isn't known until `fetchOtcToHubRoute` returns a live quote. */
export function quoteTierChange(opts: {
  config: ConfigView;
  otcPay: OtcPayView | null;
  fromTier: number;
  toTier: number;
}): TierQuote {
  const { config, otcPay, fromTier, toTier } = opts;
  assertTierRange(fromTier, toTier);
  const steps = toTier - fromTier;
  const reason = otcUnavailableReason(otcPay);
  return {
    steps,
    // Flat: one `activate_tier`/`upgrade_tier` call always costs one step fee, regardless of
    // how many tiers it crosses.
    solLamports: config.stepFeeLamports,
    otcAvailable: !reason && otcPayable(otcPay),
    otcUnavailableReason: reason,
    hubBurnUnits: hubCostDeltaUnits(fromTier, toTier),
  };
}

/**
 * Sizes and builds the $OTC→$HUB Jupiter route `activate_tier_otc`/`upgrade_tier_otc` swap-burns
 * on-chain (§otc_pay.rs). Swap V2's `/build` (the CPI-oriented endpoint, raw instruction data, no
 * ALT dependency) is ExactIn-only, so this first asks the legacy Metis `/quote` for an ExactOut
 * estimate of the $OTC input needed to clear `minHubOut`, pads it for drift between the two calls,
 * then builds the real route via `/build` — double-checking its own `otherAmountThreshold` still
 * clears `minHubOut`, the same floor `jupiter_swap::swap_exact_in` enforces on-chain.
 */
export async function fetchOtcToHubRoute(opts: {
  taker: PublicKey;
  otcMint: PublicKey;
  hubMint: PublicKey;
  destinationTokenAccount: PublicKey;
  minHubOut: bigint;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<OtcSwapRoute> {
  const { taker, otcMint, hubMint, destinationTokenAccount, minHubOut } = opts;
  if (minHubOut <= 0n) throw new Error("fetchOtcToHubRoute: minHubOut must be > 0");
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = opts.apiKey ? { "x-api-key": opts.apiKey } : undefined;

  const qqs = new URLSearchParams({
    inputMint: otcMint.toBase58(),
    outputMint: hubMint.toBase58(),
    amount: minHubOut.toString(),
    swapMode: "ExactOut",
    slippageBps: String(OTC_SWAP_SLIPPAGE_BPS),
  });
  const qRes = await doFetch(`${JUP_QUOTE_API}?${qqs}`, { headers });
  const qBody = (await qRes.json().catch(() => ({}))) as { inAmount?: string; error?: string };
  if (!qRes.ok || !qBody.inAmount)
    throw new Error(qBody.error ?? `Jupiter quote HTTP ${qRes.status}`);
  const estimatedIn = BigInt(qBody.inAmount);
  const otcSwapAmount = (estimatedIn * BigInt(BPS + OTC_SWAP_INPUT_BUFFER_BP)) / BigInt(BPS);

  const bqs = new URLSearchParams({
    inputMint: otcMint.toBase58(),
    outputMint: hubMint.toBase58(),
    amount: otcSwapAmount.toString(),
    taker: taker.toBase58(),
    slippageBps: String(OTC_SWAP_SLIPPAGE_BPS),
    wrapAndUnwrapSol: "false",
    destinationTokenAccount: destinationTokenAccount.toBase58(),
  });
  const bRes = await doFetch(`${JUP_BUILD_API}?${bqs}`, { headers });
  const bBody = (await bRes.json().catch(() => ({}))) as {
    outAmount?: string;
    otherAmountThreshold?: string;
    routePlan?: { swapInfo?: { label?: string } }[];
    swapInstruction?: {
      programId: string;
      accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
      data: string;
    };
    error?: string;
  };
  if (!bRes.ok || !bBody.swapInstruction)
    throw new Error(bBody.error ?? `Jupiter build HTTP ${bRes.status}`);
  const ix = bBody.swapInstruction;
  if (ix.programId !== JUPITER_PROGRAM_ID)
    throw new Error(`Jupiter build returned unexpected programId ${ix.programId}`);
  const minOut = BigInt(bBody.otherAmountThreshold ?? "0");
  if (minOut < minHubOut)
    throw new Error("Jupiter route can't clear the required $HUB output right now — try again");
  return {
    otcSwapAmount,
    jupiterData: Buffer.from(ix.data, "base64"),
    remainingAccounts: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    outAmount: BigInt(bBody.outAmount ?? "0"),
    routeLabels: (bBody.routePlan ?? [])
      .map((p) => p.swapInfo?.label)
      .filter((l): l is string => !!l),
  };
}

/**
 * Unsigned ixs: optional `claim_yield`, then exactly ONE of `activate_tier(toTier)` (fresh
 * activation, straight into `toTier`) or `upgrade_tier(toTier)` (already active) — never both.
 * A fresh T4 activation is one `activate_tier(4)` call, not `activate_tier` + `upgrade_tier(4)`.
 */
export async function buildTierChangeIxs(opts: {
  program: HubProgram;
  payer: PublicKey;
  deskAsset: PublicKey;
  fromTier: number;
  toTier: number;
  method: PayMethod;
  config: ConfigView;
  otcPay: OtcPayView | null;
  /** §A5 90% leg state — required to settle pending yield before an upgrade (see below), and to
   *  fund the $OTC path's desk-pot vault. */
  otcPot: OtcPotView | null;
  /** Required — the 50%-of-cost "reward" leg of the burn split lands in
   *  `tokenomics.treasuryLockVault` (see `Config.tier_cost_burn_bp`). */
  tokenomics: TokenomicsView | null;
  pendingLamports: number;
  /** Required for `method: "otc"` — a live route from `fetchOtcToHubRoute`, sized to clear this
   *  call's `hubCostDeltaUnits`. Unused on the SOL path. */
  otcRoute?: OtcSwapRoute;
}): Promise<TransactionInstruction[]> {
  const { program, payer, deskAsset, fromTier, toTier, method, config, otcPay, otcPot } = opts;
  assertTierRange(fromTier, toTier);
  if (!opts.tokenomics)
    throw new Error("TokenomicsConfig isn't initialized on this cluster (init_tokenomics)");
  const id = program.programId;
  const ixs: TransactionInstruction[] = [];
  if (fromTier > 0 && opts.pendingLamports > 0) {
    if (!otcPot || otcPot.totalLamportsSpent <= 0)
      throw new Error(
        "pending yield must be claimed before upgrading, but the $OTC yield vault isn't funded yet",
      );
    // Idempotent — a no-op if the payer already has the ATA; the settle-claim below pays into it.
    ixs.push(createAtaIdempotentIx(payer, payer, new PublicKey(config.otcMint)));
    ixs.push(await buildClaimYieldIx(program, payer, deskAsset, config, otcPot));
  }
  const hubMint = new PublicKey(config.hubMint);
  const common = {
    payer,
    deskAsset,
    config: configPda(id)[0],
    epoch: epochPda(id, config.currentEpoch)[0],
    pot: potPda(id)[0],
    opsWallet: new PublicKey(config.opsWallet),
    deskTier: tierPda(id, deskAsset)[0],
    hubMint,
    payerHub: ataPda(payer, hubMint)[0],
    tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
    tokenomics: tokenomicsPda(id)[0],
    treasuryLockVault: new PublicKey(opts.tokenomics.treasuryLockVault),
  };

  if (method === "sol") {
    const accs = { ...common, systemProgram: SYSTEM_PROGRAM };
    if (fromTier === 0)
      ixs.push(await program.methods.activateTier(toTier).accountsStrict(accs).instruction());
    else ixs.push(await program.methods.upgradeTier(toTier).accountsStrict(accs).instruction());
    return ixs;
  }

  if (!otcPay || !otcPayable(otcPay))
    throw new Error(`$OTC payment unavailable: ${otcUnavailableReason(otcPay) ?? "not payable"}`);
  if (!otcPot) throw new Error("$OTC yield vault (OtcPotState) isn't initialized on this cluster");
  if (!opts.otcRoute)
    throw new Error("missing $OTC→$HUB Jupiter route — call fetchOtcToHubRoute first");
  const { otcSwapAmount, jupiterData, remainingAccounts } = opts.otcRoute;
  const otcMint = new PublicKey(config.otcMint);
  const accs = {
    ...common,
    systemProgram: SYSTEM_PROGRAM,
    otcPay: otcPayPda(id)[0],
    otcMint,
    payerOtc: ataPda(payer, otcMint)[0],
    otcPot: otcPotPda(id)[0],
    otcVault: new PublicKey(otcPot.otcVault),
    jupiterProgram: new PublicKey(JUPITER_PROGRAM_ID),
  };
  const swapAmountBn = new BN(otcSwapAmount.toString());
  if (fromTier === 0)
    ixs.push(
      await program.methods
        .activateTierOtc(toTier, swapAmountBn, jupiterData)
        .accountsStrict(accs)
        .remainingAccounts(remainingAccounts)
        .instruction(),
    );
  else
    ixs.push(
      await program.methods
        .upgradeTierOtc(toTier, swapAmountBn, jupiterData)
        .accountsStrict(accs)
        .remainingAccounts(remainingAccounts)
        .instruction(),
    );
  return ixs;
}

/**
 * Activate / upgrade one desk in a single tx: build → sim (unsigned; a failing sim is dropped, no
 * fee spent) → one sign prompt → send → confirm.
 */
export async function executeTierChange(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  deskAsset: string;
  fromTier: number;
  toTier: number;
  method: PayMethod;
  config: ConfigView;
  otcPay: OtcPayView | null;
  /** §A5 90% leg state — only needed when `pendingLamports > 0` on an upgrade, or on the $OTC
   *  path (desk-pot vault destination). */
  otcPot: OtcPotView | null;
  /** Required — see `buildTierChangeIxs`. */
  tokenomics: TokenomicsView | null;
  pendingLamports: number;
  /** Required for `method: "otc"` — see `buildTierChangeIxs`. */
  otcRoute?: OtcSwapRoute;
  onLog: (l: TxLog) => void;
  onPhase?: (p: TierChangePhase) => void;
}): Promise<TierChangeResult> {
  const { connection, program, signer, deskAsset, fromTier, toTier, method, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  const fail = (reason: string): TierChangeResult => ({ asset: deskAsset, ok: false, reason });
  try {
    onPhase?.("build");
    const ixs = await buildTierChangeIxs({
      program,
      payer,
      deskAsset: new PublicKey(deskAsset),
      fromTier,
      toTier,
      method,
      config: opts.config,
      otcPay: opts.otcPay,
      otcPot: opts.otcPot,
      tokenomics: opts.tokenomics,
      pendingLamports: opts.pendingLamports,
      otcRoute: opts.otcRoute,
    });
    const bh = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
      ...ixs,
    );
    const verb = fromTier === 0 ? "ACTIVATE" : "UPGRADE";
    onLog({
      type: "info",
      msg: `${verb} :: T${fromTier} → T${toTier} via ${method.toUpperCase()} (${ixs.length} ix)`,
    });

    onPhase?.("sim");
    const sim = await connection.simulateTransaction(tx, undefined, false);
    if (sim.value.err) {
      const line = sim.value.logs?.find((l) => /Error Message|Error Code/.test(l));
      const reason = line?.replace("Program log: ", "") ?? JSON.stringify(sim.value.err);
      onLog({ type: "err", msg: `SIM_FAIL: ${reason}` });
      return fail(reason);
    }
    onLog({ type: "sim", msg: `sim OK (${sim.value.unitsConsumed ?? "?"} CU)` });

    onPhase?.("sign");
    onLog({ type: "info", msg: "SIGN :: 1 prompt for 1 tx…" });
    let signed: Uint8Array;
    try {
      signed = await signer.signTransactionRaw(tx);
    } catch (e) {
      onLog({ type: "err", msg: `SIGN_REJECTED: ${(e as Error).message}` });
      return fail("rejected");
    }

    onPhase?.("send");
    const sig = await connection.sendRawTransaction(signed, {
      skipPreflight: true,
      maxRetries: 3,
    });
    onLog({ type: "ok", msg: `SENT ${sig.slice(0, 8)}…`, sig });

    onPhase?.("confirm");
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      const reason = JSON.stringify(conf.value.err);
      onLog({ type: "err", msg: `FAILED_ON_CHAIN: ${reason}`, sig });
      return { asset: deskAsset, ok: false, sig, reason };
    }
    onLog({ type: "ok", msg: `DONE :: desk now T${toTier}`, sig });
    return { asset: deskAsset, ok: true, sig };
  } catch (e) {
    const reason = (e as Error).message;
    onLog({ type: "err", msg: `ABORT: ${reason}` });
    return fail(reason);
  }
}
