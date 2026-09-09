// Devnet/localnet-only route builder for `programs/mock_jupiter` — a same-CPI-interface stand-in
// for the real Jupiter v6 aggregator, used to exercise `finalize_epoch` / `activate_tier_otc` /
// `upgrade_tier_otc`'s synchronous swap leg end-to-end on devnet, where Jupiter v6 itself does not
// exist and $HUB/$OTC have no real liquidity yet (see programs/mock_jupiter/src/lib.rs and hub's
// `mock-jupiter` Cargo feature). Only valid against a `hub` deploy built with that feature — run
// `npx ts-node -T scripts/mock-jupiter-setup.ts` once first to fund the mock's liquidity vaults.
//
// Mirrors keeper/keeper/src/jupiter.ts's shape (returns `{ jupiterData, remainingAccounts }`
// consumable by `FinalizeSwapArgs` / the SDK's `OtcSwapRoute`) but is fully deterministic: the
// caller states both `amountIn` and `amountOut` directly instead of fetching a live quote.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import crypto from "node:crypto";
import { ata, ATA_PROGRAM_ID, createAtaIdempotent, TOKEN_PROGRAM_ID, type Ctx } from "./devnet";
import { MOCK_JUPITER_PROGRAM_ID } from "../../sdk/src";

export const MOCK_JUPITER_PROGRAM = new PublicKey(MOCK_JUPITER_PROGRAM_ID);
export const SEED_MOCK_AUTHORITY = Buffer.from("mock_authority");

/** Anchor sighash `sha256("global:<ix>")[..8]` — computed here (not vendored from an IDL),
 * matching hub's own constants.rs convention for external-program discriminators. */
function sighash(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

export const mockAuthorityPda = () =>
  PublicKey.findProgramAddressSync([SEED_MOCK_AUTHORITY], MOCK_JUPITER_PROGRAM)[0];

/** This program's pre-funded liquidity reserve for `mint` — a plain ATA owned by
 * `mockAuthorityPda()`, funded once by `scripts/mock-jupiter-setup.ts`. */
export const mockLiquidityAta = (mint: PublicKey) => ata(mockAuthorityPda(), mint);

function u64le(n: bigint | number | string): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export type MockRouteArgs = {
  /** Owner/authority of `sourceTokenAccount` — the payer wallet (OTC-pay path) or a hub PDA
   * (`vault`, for the finalize_epoch SOL leg) that hub itself re-signs for via `invoke_signed`. */
  sourceAuthority: PublicKey;
  sourceTokenAccount: PublicKey;
  sourceMint: PublicKey;
  destinationTokenAccount: PublicKey;
  destinationMint: PublicKey;
  amountIn: bigint | number | string;
  /** Simulated swap output — hub's own `min_out` balance-delta check still enforces the real
   * caller-supplied floor independently, so setting this below that floor exercises
   * `SlippageExceeded` exactly as a bad real-Jupiter route would. */
  amountOut: bigint | number | string;
};

/**
 * Builds `{ jupiterData, remainingAccounts }` for one `mock_swap` CPI — pass straight into
 * `finalizeIx`'s `FinalizeSwapArgs` (with `jupiterProgram: MOCK_JUPITER_PROGRAM`) or the SDK's
 * `activateTierOtc`/`upgradeTierOtc` remaining-accounts slot. Account order matches
 * `programs/mock_jupiter/src/lib.rs::MockSwap` exactly.
 */
export function mockRoute(args: MockRouteArgs) {
  const mockAuthority = mockAuthorityPda();
  const jupiterData = Buffer.concat([
    sighash("mock_swap"),
    u64le(args.amountIn),
    u64le(args.amountOut),
  ]);
  const remainingAccounts = [
    { pubkey: args.sourceAuthority, isSigner: true, isWritable: false },
    { pubkey: args.sourceTokenAccount, isSigner: false, isWritable: true },
    { pubkey: args.sourceMint, isSigner: false, isWritable: false },
    { pubkey: args.destinationTokenAccount, isSigner: false, isWritable: true },
    { pubkey: args.destinationMint, isSigner: false, isWritable: false },
    { pubkey: mockLiquidityAta(args.sourceMint), isSigner: false, isWritable: true },
    { pubkey: mockLiquidityAta(args.destinationMint), isSigner: false, isWritable: true },
    { pubkey: mockAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return { jupiterData, remainingAccounts };
}

/** Idempotently creates `mockAuthorityPda()`'s liquidity ATA for `mint` (no-op if it exists). */
export function ensureMockLiquidityAtaIx(payer: PublicKey, mint: PublicKey): TransactionInstruction {
  return createAtaIdempotent(payer, mockAuthorityPda(), mint);
}

export { ATA_PROGRAM_ID };
export type { Ctx };
