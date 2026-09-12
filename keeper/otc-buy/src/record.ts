// Pure-ish helpers for the `record_otc_buy` step, split out of `./index.ts` so the
// resume-across-crash decision (`findUnresolvedSwap`) is unit-testable without RPC/signing.
import { BN, utils } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ataPda,
  configPda,
  createAtaIdempotentIx,
  otcPotPda,
  potPda,
  TOKEN_2022_PROGRAM_ID,
  type HubProgram,
} from "../../../sdk/src";
import type { JournalEntry } from "../../shared/src/journal";

/** A Solana tx signature is exactly 64 bytes (ed25519) — the same width as `RecordOtcBuy`'s
 *  `buy_tx: [u8; 64]` proof field, so no padding/truncation is ever needed. */
export function signatureToBuyTx(signature: string): number[] {
  const raw = utils.bytes.bs58.decode(signature);
  if (raw.length !== 64) {
    throw new Error(
      `signatureToBuyTx: expected a 64-byte signature, got ${raw.length} bytes (${signature})`,
    );
  }
  return Array.from(raw);
}

export type UnresolvedSwap = {
  otcBought: bigint;
  lamportsSpent: bigint;
  /** The Jupiter swap tx's own signature — becomes `record_otc_buy`'s `buy_tx` proof. */
  signature: string;
};

/**
 * Resume-safety: crashing between the Jupiter swap landing and `record_otc_buy` confirming
 * must never re-front new SOL on the next cycle. Walks the journal backward from the newest
 * `otc-buy` entry:
 *   - `sent`                → last cycle's buy already recorded on-chain; nothing to resume.
 *   - `swap-sent`           → swap landed, record step never confirmed; resume with its meta.
 *   - `confirm-error`       → same as above, one or more record attempts already failed;
 *                             the original swap signature is preserved in `meta.swapSignature`.
 *   - anything else (waited/blocked/dry-run/error) → no swap succeeded yet, start fresh.
 */
export function findUnresolvedSwap(entries: JournalEntry[]): UnresolvedSwap | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.service !== "otc-buy") continue;
    if (e.status === "sent") return null;
    const meta = e.meta ?? {};
    if (e.status === "swap-sent") {
      if (typeof meta.otcBought !== "string" || typeof meta.lamportsSpent !== "string" || !e.signature) {
        return null; // malformed/legacy entry — don't try to resume off it
      }
      return { otcBought: BigInt(meta.otcBought), lamportsSpent: BigInt(meta.lamportsSpent), signature: e.signature };
    }
    if (e.status === "confirm-error") {
      if (
        typeof meta.otcBought !== "string" ||
        typeof meta.lamportsSpent !== "string" ||
        typeof meta.swapSignature !== "string"
      ) {
        return null;
      }
      return {
        otcBought: BigInt(meta.otcBought),
        lamportsSpent: BigInt(meta.lamportsSpent),
        signature: meta.swapSignature,
      };
    }
    return null;
  }
  return null;
}

/**
 * Submits `record_otc_buy` for an already-landed swap. Always prepends an idempotent-create of
 * the keeper's own $OTC ATA (cheap no-op if Jupiter's own swap tx already created it) so a
 * resume after a crash never depends on remembering whether that step ran.
 */
export async function recordBuy(
  program: HubProgram,
  keeper: Keypair,
  otcMint: PublicKey,
  otcVault: PublicKey,
  swap: UnresolvedSwap,
): Promise<string> {
  const id = program.programId;
  const [configKey] = configPda(id);
  const [otcPotKey] = otcPotPda(id);
  const [potKey] = potPda(id);
  const [keeperOtc] = ataPda(keeper.publicKey, otcMint, TOKEN_2022_PROGRAM_ID);
  const createAtaIx = createAtaIdempotentIx(keeper.publicKey, keeper.publicKey, otcMint, TOKEN_2022_PROGRAM_ID);
  const buyTx = signatureToBuyTx(swap.signature);

  return program.methods
    .recordOtcBuy(new BN(swap.otcBought.toString()), new BN(swap.lamportsSpent.toString()), buyTx)
    .accountsPartial({
      keeper: keeper.publicKey,
      config: configKey,
      otcPot: otcPotKey,
      otcMint,
      keeperOtc,
      otcVault,
      pot: potKey,
      tokenProgram: new PublicKey(TOKEN_2022_PROGRAM_ID),
    })
    .preInstructions([createAtaIx])
    .signers([keeper])
    .rpc();
}
