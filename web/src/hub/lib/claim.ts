// $HUB claim portal: `claim_yield` for every activated desk a wallet owns. Same reliability model
// as otchub's OTC stock claim (otcClaim.js): every tx is SIMULATED unsigned first (a failing sim is
// dropped, no fee spent), one wallet prompt signs the whole passing batch, txs are broadcast and
// then confirmed. The program enforces `claimer == desk owner`; the pot pays the claimer directly.
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
  TOKEN_PROGRAM_ID,
  type HubProgram,
} from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type ClaimPhase = "build" | "sim" | "sign" | "send" | "confirm";
export type ClaimResult = { asset: string; ok: boolean; sig?: string; reason?: string };

const CU_LIMIT = 300_000;
const CU_PRICE_MICRO = 10_000;
/**
 * Legacy tx message budget; claim_yield now pays the $OTC leg via `transfer_checked` (11
 * accounts, incl. the token program), so a smaller batch than the old SOL-only path keeps
 * every packed tx well under 1232 B once the shared accounts (config/pot/otcPot/otcMint/
 * otcVault/claimerOtc) are deduped by the message compiler.
 */
const MAX_IXS_PER_TX = 3;

/** Unsigned `claim_yield` instruction — built through the read-only Anchor reader (no provider wallet). */
export async function buildClaimYieldIx(
  program: HubProgram,
  claimer: PublicKey,
  deskAsset: PublicKey,
  otc: { mint: PublicKey; vault: PublicKey },
): Promise<TransactionInstruction> {
  const id = program.programId;
  return program.methods
    .claimYield()
    .accountsStrict({
      claimer,
      deskAsset,
      config: configPda(id)[0],
      deskTier: tierPda(id, deskAsset)[0],
      pot: potPda(id)[0],
      otcPot: otcPotPda(id)[0],
      otcMint: otc.mint,
      otcVault: otc.vault,
      claimerOtc: ataPda(claimer, otc.mint)[0],
      tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();
}

/**
 * The claimer's $OTC ATA is never created by the program (§B3, `require_token_account` only
 * checks mint/owner on an existing account) — prepend a `CreateIdempotent` to EVERY packed tx
 * (not just the first) since all txs are simulated against the same pre-landing state.
 */
function packTxs(
  ixs: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  ataIx: TransactionInstruction,
) {
  const txs: Transaction[] = [];
  for (let i = 0; i < ixs.length; i += MAX_IXS_PER_TX) {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
      ataIx,
      ...ixs.slice(i, i + MAX_IXS_PER_TX),
    );
    txs.push(tx);
  }
  return txs;
}

/**
 * Claim yield for `assets` (one ix each, packed per tx). Sim → one signAll prompt → send →
 * confirm. Results are per asset; a dropped tx marks all of its assets failed.
 */
export async function executeClaimYield(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  assets: string[];
  onLog: (l: TxLog) => void;
  onPhase?: (p: ClaimPhase) => void;
}): Promise<ClaimResult[]> {
  const { connection, program, signer, assets, onLog, onPhase } = opts;
  const claimer = new PublicKey(signer.publicKey);
  const results: ClaimResult[] = [];
  if (!assets.length) return results;

  onPhase?.("build");
  const id = program.programId;
  const [configKey] = configPda(id);
  const [otcPotKey] = otcPotPda(id);
  const [config, otcPot] = await Promise.all([
    program.account.config.fetch(configKey),
    program.account.otcPotState.fetch(otcPotKey),
  ]);
  const otc = { mint: config.otcMint as PublicKey, vault: otcPot.otcVault as PublicKey };
  const ataIx = createAtaIdempotentIx(claimer, claimer, otc.mint);
  const ixs = await Promise.all(
    assets.map((a) => buildClaimYieldIx(program, claimer, new PublicKey(a), otc)),
  );
  const bh = await connection.getLatestBlockhash("confirmed");
  const txs = packTxs(ixs, claimer, bh.blockhash, ataIx);
  const assetsOf = (i: number) => assets.slice(i * MAX_IXS_PER_TX, (i + 1) * MAX_IXS_PER_TX);
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
