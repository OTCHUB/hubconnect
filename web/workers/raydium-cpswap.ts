// Minimal client for Raydium CP-Swap's `initialize` instruction on Solana Devnet — used only by
// the bonding curve's graduation flow (bonding-curve.ts) to migrate the curve's collected SOL +
// remaining $HUB into a real devnet AMM pool once the graduation target is reached.
//
// The program id / AmmConfig / create_pool_fee receiver below were verified directly against
// live devnet state (not taken on faith from a possibly-stale published address):
// `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` owns ~11.5k pool-shaped accounts and exactly 9
// AmmConfig accounts on devnet; config index 0's `create_pool_fee` (0.15 SOL) times ~11.5k pools
// reconciles almost exactly against the accumulated balance of `3oE58...b6eYy` (the fee receiver
// its `initialize` ix hardcodes) — confirming both addresses belong to the same live deployment.
// This is a *different* program id than `RAYDIUM_CP_SWAP_PROGRAM_ID` in
// programs/hub/src/constants.rs — that one is for the on-chain `hub` program's later mainnet
// lock+burn CPI (§A6.2 phase-2), a separate, real-money concern from this devnet-only curve sim.
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./curve-ix";

export const CPMM_PROGRAM_ID = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
/** AmmConfig index 0: 0.25% trade fee, 0.15 SOL create-pool fee (read on-chain, not guessed). */
export const CPMM_AMM_CONFIG = new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy");
export const CPMM_CREATE_POOL_FEE_RECEIVER = new PublicKey(
  "3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy",
);
/** `AmmConfig(index 0).create_pool_fee` — native SOL the creator pays on top of pool liquidity. */
export const CPMM_CREATE_POOL_FEE_LAMPORTS = 150_000_000n;
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

function findPda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, CPMM_PROGRAM_ID);
}

export type CpSwapPoolKeys = {
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  authority: PublicKey;
  poolState: PublicKey;
  lpMint: PublicKey;
  vault0: PublicKey;
  vault1: PublicKey;
  observationState: PublicKey;
};

/** Derives every PDA `initialize` needs for a `hubMint`/native-SOL pool. Orders token_0/token_1
 * by raw pubkey bytes — exactly the program's `token_0_mint.key() < token_1_mint.key()`
 * constraint — never assume $HUB lands on either side; it depends only on its 32-byte address. */
export function deriveCpSwapPoolKeys(hubMint: PublicKey): CpSwapPoolKeys {
  const hubFirst = Buffer.compare(hubMint.toBuffer(), WSOL_MINT.toBuffer()) < 0;
  const token0Mint = hubFirst ? hubMint : WSOL_MINT;
  const token1Mint = hubFirst ? WSOL_MINT : hubMint;
  const [authority] = findPda([Buffer.from("vault_and_lp_mint_auth_seed")]);
  const [poolState] = findPda([
    Buffer.from("pool"),
    CPMM_AMM_CONFIG.toBuffer(),
    token0Mint.toBuffer(),
    token1Mint.toBuffer(),
  ]);
  const [lpMint] = findPda([Buffer.from("pool_lp_mint"), poolState.toBuffer()]);
  const [vault0] = findPda([
    Buffer.from("pool_vault"),
    poolState.toBuffer(),
    token0Mint.toBuffer(),
  ]);
  const [vault1] = findPda([
    Buffer.from("pool_vault"),
    poolState.toBuffer(),
    token1Mint.toBuffer(),
  ]);
  const [observationState] = findPda([Buffer.from("observation"), poolState.toBuffer()]);
  return { token0Mint, token1Mint, authority, poolState, lpMint, vault0, vault1, observationState };
}

/** spl-token `SyncNative` (ix 17, no args) — reconciles a WSOL account's token balance with its
 * lamport balance after a plain SystemProgram transfer wraps SOL into it. */
export function syncNativeIx(tokenAccount: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: tokenAccount, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

/** Raydium CP-Swap `initialize { init_amount_0, init_amount_1, open_time }` — creates a brand new
 * pool for `keys.token0Mint`/`keys.token1Mint`. `creator` pays the AmmConfig's `create_pool_fee`
 * (plain SOL transfer, separate from the deposited liquidity) plus rent for every new account
 * this ix creates (lp_mint, creator_lp_token ATA, both vaults, pool_state, observation_state).
 * `creatorToken0`/`creatorToken1` must already exist and hold ≥ `initAmount0`/`initAmount1` —
 * this instruction only moves tokens the creator already has, it never mints or wraps anything. */
export function buildCpSwapInitializeIx(params: {
  creator: PublicKey;
  keys: CpSwapPoolKeys;
  creatorToken0: PublicKey;
  creatorToken1: PublicKey;
  creatorLpToken: PublicKey;
  initAmount0: bigint;
  initAmount1: bigint;
  openTime?: bigint;
}): TransactionInstruction {
  const { creator, keys, creatorToken0, creatorToken1, creatorLpToken, initAmount0, initAmount1 } =
    params;
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  INITIALIZE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(initAmount0, 8);
  data.writeBigUInt64LE(initAmount1, 16);
  data.writeBigUInt64LE(params.openTime ?? 0n, 24);
  const keysMeta = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: CPMM_AMM_CONFIG, isSigner: false, isWritable: false },
    { pubkey: keys.authority, isSigner: false, isWritable: false },
    { pubkey: keys.poolState, isSigner: false, isWritable: true },
    { pubkey: keys.token0Mint, isSigner: false, isWritable: false },
    { pubkey: keys.token1Mint, isSigner: false, isWritable: false },
    { pubkey: keys.lpMint, isSigner: false, isWritable: true },
    { pubkey: creatorToken0, isSigner: false, isWritable: true },
    { pubkey: creatorToken1, isSigner: false, isWritable: true },
    { pubkey: creatorLpToken, isSigner: false, isWritable: true },
    { pubkey: keys.vault0, isSigner: false, isWritable: true },
    { pubkey: keys.vault1, isSigner: false, isWritable: true },
    { pubkey: CPMM_CREATE_POOL_FEE_RECEIVER, isSigner: false, isWritable: true },
    { pubkey: keys.observationState, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: CPMM_PROGRAM_ID, keys: keysMeta, data });
}
