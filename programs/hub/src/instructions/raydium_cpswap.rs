//! §A6.2 phase-2 lock+burn — thin passthrough CPI into Raydium CP-Swap's `deposit` and its
//! sister locking program's `lock_cp_liquidity`. No raydium crate dependency: this program
//! already hand-rolls every external-program CPI (spl-token in `otc_pay.rs`, Metaplex Core in
//! `mpl_core.rs`); Raydium is no different, it's just a longer account list.
//!
//! The account list for each CPI is exactly the accounts Raydium's published IDL expects, in
//! IDL order, supplied by the caller as `ctx.remaining_accounts` (the client/keeper assembles
//! them — this program has no way to derive Raydium's internal pool PDAs itself, same posture
//! `build_lp` already documented before this module existed: "AMM pool accounts arrive as
//! remaining_accounts once the graduation AMM is fixed"). What this program DOES enforce:
//! the two fixed program ids and the two Anchor instruction discriminators, so a keeper can
//! never redirect the CPI to an unrelated program. Verify the exact account order against
//! Raydium's IDL on devnet before mainnet — same discipline as every other external program.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::constants::*;
use crate::errors::HubError;

fn metas_from(accounts: &[AccountInfo]) -> Vec<AccountMeta> {
    accounts
        .iter()
        .map(|ai| AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer,
            is_writable: ai.is_writable,
        })
        .collect()
}

fn infos_owned<'info>(accounts: &[AccountInfo<'info>]) -> Vec<AccountInfo<'info>> {
    accounts.to_vec()
}

/// Raydium CP-Swap `deposit { lp_token_amount, maximum_token_0_amount, maximum_token_1_amount }`
/// — deposits paired HUB+OTC liquidity at the pool's current ratio. `pool_accounts` must be in
/// Raydium's IDL order for this instruction (owner/authority, pool_state, owner_lp_token,
/// token_0/1 accounts, vaults, mints, token programs...).
pub fn deposit<'info>(
    pool_accounts: &[AccountInfo<'info>],
    lp_token_amount: u64,
    maximum_token_0_amount: u64,
    maximum_token_1_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(!pool_accounts.is_empty(), HubError::LpAccountsMissing);
    let mut data = Vec::with_capacity(32);
    data.extend_from_slice(&RAYDIUM_IX_DEPOSIT);
    data.extend_from_slice(&lp_token_amount.to_le_bytes());
    data.extend_from_slice(&maximum_token_0_amount.to_le_bytes());
    data.extend_from_slice(&maximum_token_1_amount.to_le_bytes());
    let ix = Instruction {
        program_id: RAYDIUM_CP_SWAP_PROGRAM_ID,
        accounts: metas_from(pool_accounts),
        data,
    };
    invoke_signed(&ix, &infos_owned(pool_accounts), signer_seeds)?;
    Ok(())
}

/// Raydium's CP-Swap locking program `lock_cp_liquidity { lp_amount, with_metadata }` — burns
/// the LP mint tokens outright and mints a permanent fee-claim position to the treasury vault
/// PDA. `lock_accounts` must be in the locking program's IDL order (authority, fee_nft_owner,
/// fee_nft_mint, fee_nft_account, pool_state, locked_liquidity, lock authority PDA, lp_mint,
/// liquidity_owner's LP token account, lock's own LP vault, token programs, system/rent...).
pub fn lock_cp_liquidity<'info>(
    lock_accounts: &[AccountInfo<'info>],
    lp_amount: u64,
    with_metadata: bool,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(!lock_accounts.is_empty(), HubError::LpAccountsMissing);
    let mut data = Vec::with_capacity(17);
    data.extend_from_slice(&RAYDIUM_IX_LOCK_CP_LIQUIDITY);
    data.extend_from_slice(&lp_amount.to_le_bytes());
    data.push(with_metadata as u8);
    let ix = Instruction {
        program_id: RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID,
        accounts: metas_from(lock_accounts),
        data,
    };
    invoke_signed(&ix, &infos_owned(lock_accounts), signer_seeds)?;
    Ok(())
}
