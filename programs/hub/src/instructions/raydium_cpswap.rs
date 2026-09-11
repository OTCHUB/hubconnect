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

/// Same elevation `jupiter_swap::metas_from` uses: forces `is_signer: true` for any account
/// whose key matches a PDA derivable from `signer_seeds` (here, the vault PDA acting as
/// `swap_base_input`'s `payer`), since a client can never mark a PDA as signer in the outer
/// transaction and `invoke_signed` only recognizes the elevation when the meta says so.
fn metas_from_pda(accounts: &[AccountInfo], signer_seeds: &[&[&[u8]]]) -> Result<Vec<AccountMeta>> {
    let mut signer_pdas: Vec<Pubkey> = Vec::with_capacity(signer_seeds.len());
    for seeds in signer_seeds.iter().copied() {
        let pda = Pubkey::create_program_address(seeds, &crate::ID)
            .map_err(|_| error!(HubError::MathOverflow))?;
        signer_pdas.push(pda);
    }
    Ok(accounts
        .iter()
        .map(|ai| AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer || signer_pdas.contains(ai.key),
            is_writable: ai.is_writable,
        })
        .collect())
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

/// Locking program's `collect_cp_fees {}` (no args) — harvests whatever trading fees have
/// accrued to a `lock_cp_liquidity`-created position, straight into the fee-claim NFT holder's
/// (the treasury vault PDA's) token-0/token-1 recipient accounts. `harvest_accounts` must be in
/// the locking program's IDL order (authority, fee_nft_owner, fee_nft_account, pool_state,
/// locked_liquidity, lock authority PDA, recipient_token_0_account, recipient_token_1_account,
/// pool vaults 0/1, vault mints 0/1, token programs...). The caller (`treasury::harvest_lp_fees`)
/// reads the recipient accounts' balances before/after this call to learn how much was harvested
/// — this CPI has no return value and Raydium reports nothing beyond the accounts it credits.
pub fn collect_cp_fees<'info>(
    harvest_accounts: &[AccountInfo<'info>],
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(!harvest_accounts.is_empty(), HubError::LpAccountsMissing);
    let ix = Instruction {
        program_id: RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID,
        accounts: metas_from(harvest_accounts),
        data: RAYDIUM_IX_COLLECT_CP_FEES.to_vec(),
    };
    invoke_signed(&ix, &infos_owned(harvest_accounts), signer_seeds)?;
    Ok(())
}

/// Raydium CP-Swap `swap_base_input { amount_in, minimum_amount_out }` — `finalize_epoch`'s
/// direct-CPI replacement for a Jupiter-routed hop2 (USDC→$HUB). Jupiter's Metis routing engine
/// gates newly-created pools out of "normal routing" on a liquidity-depth check regardless of
/// whether the on-chain pool itself is real and swappable (see `epochs.rs`'s `finalize_epoch` doc
/// comment); calling Raydium's CP-Swap program directly sidesteps that off-chain gate entirely.
/// `pool_accounts` must be exactly Raydium's IDL order for this instruction: payer (the vault
/// PDA, elevated to signer via `signer_seeds`), authority (Raydium's global
/// `vault_and_lp_mint_auth_seed` PDA), amm_config, pool_state, input_token_account,
/// output_token_account, input_vault, output_vault, input_token_program, output_token_program,
/// input_token_mint, output_token_mint, observation_state — all fixed per-pool addresses, so
/// unlike Jupiter's hop this needs no off-chain-assembled instruction data. Enforces
/// `dest.amount_after − dest.amount_before ≥ minimum_amount_out` independently of Raydium's own
/// slippage check — same "trust the balance, not the CPI" posture as `jupiter_swap::swap_exact_in`.
pub fn swap_base_input<'info>(
    pool_accounts: &[AccountInfo<'info>],
    amount_in: u64,
    minimum_amount_out: u64,
    dest: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    require!(!pool_accounts.is_empty(), HubError::LpAccountsMissing);
    let before = super::jupiter_swap::read_token_amount(dest)?;
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&RAYDIUM_IX_SWAP_BASE_INPUT);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());
    let ix = Instruction {
        program_id: RAYDIUM_CP_SWAP_PROGRAM_ID,
        accounts: metas_from_pda(pool_accounts, signer_seeds)?,
        data,
    };
    invoke_signed(&ix, &infos_owned(pool_accounts), signer_seeds)?;
    let after = super::jupiter_swap::read_token_amount(dest)?;
    let received = after
        .checked_sub(before)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(received >= minimum_amount_out, HubError::SlippageExceeded);
    Ok(received)
}
