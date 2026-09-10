// $OTC claim portal: `claim_yield` for every activated desk a wallet owns, paid in $OTC from the
// keeper-fed vault (§A5 90% leg — see OtcPotView/otcDueForLamports). Same reliability model as
// otchub's OTC stock claim (otcClaim.js): every tx is SIMULATED unsigned first (a failing sim is
// dropped, no fee spent), one wallet prompt signs the whole passing batch, txs are broadcast and
// then confirmed. The program enforces `claimer == desk owner`; the $OTC vault PDA pays the
// claimer's standard ATA directly.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ataPda,
  configPda,
  createAtaIdempotentIx,
  otcPotPda,
  potPda,
  tierPda,
  TOKEN_2022_PROGRAM_ID,
  type ConfigView,
  type HubProgram,
  type OtcPotView,
} from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type ClaimPhase = "build" | "sim" | "sign" | "send" | "confirm";
export type ClaimResult = { asset: string; ok: boolean; sig?: string; reason?: string };

const CU_LIMIT = 400_000;
const CU_PRICE_MICRO = 10_000;
/** Legacy tx message budget; claim_yield now CPIs into the token program (11 accounts, several
 * shared across ixs in the same tx), so 3 per tx stays well under 1232 B. */
const MAX_IXS_PER_TX = 3;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/** Unsigned `claim_yield` instruction — built through the read-only Anchor reader (no provider
 * wallet). `otcPot` must be provisioned (§A5 90% leg) — the caller should guard on this first. */
export async function buildClaimYieldIx(
  program: HubProgram,
  claimer: PublicKey,
  deskAsset: PublicKey,
  config: ConfigView,
  otcPot: OtcPotView,
): Promise<TransactionInstruction> {
  const id = program.programId;
  const otcMint = new PublicKey(config.otcMint);
  return program.methods
    .claimYield()
    .accountsStrict({
      claimer,
      deskAsset,
      config: configPda(id)[0],
      deskTier: tierPda(id, deskAsset)[0],
      pot: potPda(id)[0],
      otcPot: otcPotPda(id)[0],
      otcMint,
      otcVault: new PublicKey(otcPot.otcVault),
      claimerOtc: ataPda(claimer, otcMint, TOKEN_2022_PROGRAM_ID)[0],
      tokenProgram: new PublicKey(TOKEN_2022_PROGRAM_ID),
      systemProgram: SYSTEM_PROGRAM,
    })
    .instruction();
}

/** Splits `assets`/`ixs` into fixed-size groups — the first group shrinks to make room for the
 * $OTC ATA-create-idempotent preamble (only ever needed once, in the first tx). */
function groupBatches<T>(items: T[], preambleLen: number): T[][] {
  const groups: T[][] = [];
  const firstBatch = Math.max(1, MAX_IXS_PER_TX - preambleLen);
  for (let i = 0; i < items.length;) {
    const batch = groups.length === 0 ? firstBatch : MAX_IXS_PER_TX;
    groups.push(items.slice(i, i + batch));
    i += batch;
  }
  return groups;
}

/**
 * One `Transaction` per group of claim ixs; `preamble` (the $OTC ATA-create-idempotent ix, if
 * needed) rides along in the first tx only.
 */
function packTxs(
  ixGroups: TransactionInstruction[][],
  preamble: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
) {
  return ixGroups.map((group, i) => {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
      ...(i === 0 ? preamble : []),
      ...group,
    );
    return tx;
  });
}

/**
 * Claim yield for `assets` (one ix each, packed `MAX_IXS_PER_TX` per tx, plus a one-time $OTC ATA
 * preamble). Sim → one signAll prompt → send → confirm. Results are per asset; a dropped tx marks
 * all of its assets failed. Requires the §A5 90% leg to be provisioned (`otcPot` non-null) and to
 * have recorded at least one buy — mirrors on-chain `NoOtcPurchased`.
 */
export async function executeClaimYield(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  assets: string[];
  config: ConfigView;
  otcPot: OtcPotView | null;
  onLog: (l: TxLog) => void;
  onPhase?: (p: ClaimPhase) => void;
}): Promise<ClaimResult[]> {
  const { connection, program, signer, assets, config, otcPot, onLog, onPhase } = opts;
  const claimer = new PublicKey(signer.publicKey);
  const results: ClaimResult[] = [];
  if (!assets.length) return results;
  if (!otcPot || otcPot.totalLamportsSpent <= 0) {
    const reason = !otcPot
      ? "$OTC yield vault not provisioned yet"
      : "keeper hasn't recorded an $OTC buy yet";
    onLog({ type: "err", msg: `ABORT: ${reason}` });
    return assets.map((asset) => ({ asset, ok: false, reason }));
  }

  onPhase?.("build");
  const otcMint = new PublicKey(config.otcMint);
  const [claimerOtc] = ataPda(claimer, otcMint, TOKEN_2022_PROGRAM_ID);
  const otcAtaInfo = await connection.getAccountInfo(claimerOtc, "confirmed");
  const preamble = otcAtaInfo
    ? []
    : [createAtaIdempotentIx(claimer, claimer, otcMint, TOKEN_2022_PROGRAM_ID)];
  const ixs = await Promise.all(
    assets.map((a) => buildClaimYieldIx(program, claimer, new PublicKey(a), config, otcPot)),
  );
  const bh = await connection.getLatestBlockhash("confirmed");
  const ixGroups = groupBatches(ixs, preamble.length);
  const assetGroups = groupBatches(assets, preamble.length);
  const txs = packTxs(ixGroups, preamble, claimer, bh.blockhash);
  const assetsOf = (i: number) => assetGroups[i] ?? [];
  onLog({ type: "info", msg: `CLAIM :: ${assets.length} desk(s) in ${txs.length} tx(s)` });

  onPhase?.("sim");
  const sims = await Promise.all(
    txs.map((tx) => connection.simulateTransaction(tx, undefined, false)),
  );
  const passing: { tx: Transaction; i: number }[] = [];
  sims.forEach((s, i) => {
    if (s.value.err) {
      const line = s.value.logs?.find((l) => /Error Message|Error Code/.test(l));
      const reason = line?.replace("Program log: ", "") ?? JSON.stringify(s.value.err);
      onLog({ type: "err", msg: `TX ${i + 1} SIM_FAIL: ${reason}` });
      assetsOf(i).forEach((asset) => results.push({ asset, ok: false, reason }));
    } else {
      onLog({ type: "sim", msg: `TX ${i + 1} sim OK (${s.value.unitsConsumed ?? "?"} CU)` });
      passing.push({ tx: txs[i], i });
    }
  });
  if (!passing.length) {
    onLog({ type: "err", msg: "All simulations failed — nothing to sign." });
    return results;
  }

  onPhase?.("sign");
  onLog({ type: "info", msg: `SIGN :: 1 prompt for ${passing.length} tx(s)…` });
  let signed: Uint8Array[];
  try {
    signed = await signer.signAllTransactionsRaw(passing.map((p) => p.tx));
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${(e as Error).message}` });
    passing.forEach((p) =>
      assetsOf(p.i).forEach((asset) => results.push({ asset, ok: false, reason: "rejected" })),
    );
    return results;
  }

  onPhase?.("send");
  const sent = await Promise.all(
    signed.map(async (bytes, k) => {
      try {
        const sig = await connection.sendRawTransaction(bytes, {
          skipPreflight: true,
          maxRetries: 3,
        });
        onLog({ type: "ok", msg: `TX ${passing[k].i + 1} SENT ${sig.slice(0, 8)}…`, sig });
        return { k, sig };
      } catch (e) {
        const reason = (e as Error).message;
        onLog({ type: "err", msg: `TX ${passing[k].i + 1} SEND_FAIL: ${reason}` });
        assetsOf(passing[k].i).forEach((asset) => results.push({ asset, ok: false, reason }));
        return null;
      }
    }),
  );

  onPhase?.("confirm");
  await Promise.all(
    sent.map(async (s) => {
      if (!s) return;
      const conf = await connection.confirmTransaction({ signature: s.sig, ...bh }, "confirmed");
      const err = conf.value.err ? JSON.stringify(conf.value.err) : undefined;
      if (err)
        onLog({ type: "err", msg: `TX ${passing[s.k].i + 1} FAILED_ON_CHAIN: ${err}`, sig: s.sig });
      assetsOf(passing[s.k].i).forEach((asset) =>
        results.push({ asset, ok: !err, sig: s.sig, reason: err }),
      );
    }),
  );
  const ok = results.filter((r) => r.ok).length;
  onLog({
    type: ok === results.length ? "ok" : "err",
    msg: `DONE :: ${ok}/${results.length} desk(s) claimed`,
  });
  return results;
}
