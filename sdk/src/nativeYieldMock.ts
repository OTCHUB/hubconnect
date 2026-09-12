// Devnet-only reader for the Native Yield mock (see `nativeYieldMockPda` in ./pda). Mirrors
// otchub's `fetchOtcNativeActive` (lib/otcNative.ts) shape/batching so both the mainnet-real and
// devnet-mock paths plug into the same dashboard code with a one-line dispatch — see
// `useWalletPortfolio`'s `cluster` branch. Never throws: a failed RPC batch degrades every asset
// in that slice to "inactive / 0" instead of surfacing a broken dashboard row.
import { PublicKey, type Connection } from "@solana/web3.js";
import { nativeYieldMockPda } from "./pda";

export type NativeYieldMockEntry = {
  /** Mock vault PDA exists on-chain (funded by `devnet-native-yield-init.ts`). */
  active: boolean;
  /** Live lamport balance — the simulated accrued native yield. 0 when `active` is false. */
  accruedLamports: number;
};

/** One `getMultipleAccountsInfo` per 100 desks, matching `fetchOtcNativeActive`'s batching. */
export async function fetchNativeYieldMock(
  connection: Connection,
  programId: PublicKey,
  assetIds: string[],
): Promise<Map<string, NativeYieldMockEntry>> {
  const out = new Map<string, NativeYieldMockEntry>();
  const ids = [...new Set(assetIds)].filter((a) => {
    try {
      new PublicKey(a);
      return true;
    } catch {
      return false;
    }
  });
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const pdas = slice.map((id) => nativeYieldMockPda(programId, new PublicKey(id))[0]);
    const accounts = await connection
      .getMultipleAccountsInfo(pdas)
      .catch(() => pdas.map(() => null));
    accounts.forEach((info, j) => {
      out.set(slice[j], { active: !!info, accruedLamports: info?.lamports ?? 0 });
    });
  }
  return out;
}
