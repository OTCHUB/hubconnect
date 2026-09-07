// Desk activate / upgrade (§A4): one tx per desk, paid in SOL (`activate_tier` / `upgrade_tier`,
// 90% pot / 10% ops) or in $OTC at the fixed premium (`activate_tier_otc` / `upgrade_tier_otc`,
// proceeds → POL reserve). Same reliability model as claim.ts: simulate unsigned first, one wallet
// prompt, send, confirm. `upgrade_tier` rejects desks with pending yield, so a `claim_yield` ix is
// prepended in the same tx when needed.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  OTC_PREMIUM_BP,
  OTC_RATE_MAX_AGE_SECS,
  TOKEN_PROGRAM_ID,
  ataPda,
  configPda,
  epochPda,
  otcPayPda,
  otcPayable,
  otcStepFeeUnits,
  potPda,
  tierPda,
  type ConfigView,
  type HubProgram,
  type OtcPayView,
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
  /** null when the $OTC path cannot quote (not initialized / disabled / stale). */
  otcUnits: bigint | null;
  premiumBp: number;
  otcAvailable: boolean;
  otcUnavailableReason?: string;
};

const CU_LIMIT = 300_000;
const CU_PRICE_MICRO = 10_000;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const MAX_TIER = 4;

function assertTierRange(fromTier: number, toTier: number) {
  if (!Number.isInteger(toTier) || toTier < 1 || toTier > MAX_TIER)
    throw new Error(`target tier must be 1..${MAX_TIER}`);
  if (!Number.isInteger(fromTier) || fromTier < 0 || toTier <= fromTier)
    throw new Error("target tier must be above the current tier");
}

/** Why `otcPayable` is false, for the UI. */
export function otcUnavailableReason(p: OtcPayView | null): string | undefined {
  if (!p) return "not initialized on this cluster";
  if (!p.enabled) return "disabled";
  if (p.otcPerSol <= 0n || Math.floor(Date.now() / 1000) - p.rateTs > OTC_RATE_MAX_AGE_SECS)
    return "rate stale";
  return undefined;
}

/** Side-by-side cost of moving `fromTier → toTier` (fromTier 0 = fresh activation). */
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
  const otcAvailable = !reason && otcPayable(otcPay);
  return {
    steps,
    solLamports: config.stepFeeLamports * steps,
    otcUnits: otcAvailable && otcPay ? otcStepFeeUnits(otcPay, config, fromTier, toTier) : null,
    premiumBp: otcPay?.premiumBp ?? OTC_PREMIUM_BP,
    otcAvailable,
    otcUnavailableReason: reason,
  };
}

/** Unsigned ixs: optional `claim_yield`, then `activate` (from 0) and/or `upgrade(toTier)`. */
export async function buildTierChangeIxs(opts: {
  program: HubProgram;
  payer: PublicKey;
  deskAsset: PublicKey;
  fromTier: number;
  toTier: number;
  method: PayMethod;
  config: ConfigView;
  otcPay: OtcPayView | null;
  pendingLamports: number;
}): Promise<TransactionInstruction[]> {
  const { program, payer, deskAsset, fromTier, toTier, method, config, otcPay } = opts;
  assertTierRange(fromTier, toTier);
  const id = program.programId;
  const ixs: TransactionInstruction[] = [];
  if (fromTier > 0 && opts.pendingLamports > 0)
    ixs.push(await buildClaimYieldIx(program, payer, deskAsset));
  const needsUpgrade = toTier > Math.max(fromTier, 1);
  const common = {
    payer,
    deskAsset,
    config: configPda(id)[0],
    deskTier: tierPda(id, deskAsset)[0],
  };

  if (method === "sol") {
    const accs = {
      ...common,
      epoch: epochPda(id, config.currentEpoch)[0],
      pot: potPda(id)[0],
      opsWallet: new PublicKey(config.opsWallet),
      systemProgram: SYSTEM_PROGRAM,
    };
    if (fromTier === 0)
      ixs.push(await program.methods.activateTier().accountsStrict(accs).instruction());
    if (needsUpgrade)
      ixs.push(await program.methods.upgradeTier(toTier).accountsStrict(accs).instruction());
    return ixs;
  }

  if (!otcPay || !otcPayable(otcPay))
    throw new Error(`$OTC payment unavailable: ${otcUnavailableReason(otcPay) ?? "not payable"}`);
  const otcMint = new PublicKey(config.otcMint);
  const accs = {
    ...common,
    otcPay: otcPayPda(id)[0],
    otcMint,
    payerOtc: ataPda(payer, otcMint)[0],
    polAccount: new PublicKey(otcPay.polAccount),
    tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
  };
  if (fromTier === 0)
    ixs.push(
      await program.methods
        .activateTierOtc()
        .accountsStrict({ ...accs, systemProgram: SYSTEM_PROGRAM })
        .instruction(),
    );
  if (needsUpgrade)
    ixs.push(await program.methods.upgradeTierOtc(toTier).accountsStrict(accs).instruction());
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
  pendingLamports: number;
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
      pendingLamports: opts.pendingLamports,
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
