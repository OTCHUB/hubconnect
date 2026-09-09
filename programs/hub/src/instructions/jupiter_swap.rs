//! Real on-chain SOL→$HUB / $OTC→$HUB swaps via Jupiter's aggregator (v6), invoked
//! *synchronously* from `finalize_epoch` (the round-split's combined burn/LP/treasury-float
//! leg) and `otc_pay.rs` (the 2× premium's swap-burn leg) — so both clear at the live market
//! rate and generate genuine AMM volume/fees instead of a keeper-attested off-chain buy.
//!
//! Jupiter has no fixed per-instruction account list (the router picks a different combination
//! of AMMs/hops per quote), so — mirroring `raydium_cpswap.rs`'s trust model — this program
//! cannot assemble the CPI itself. The caller (keeper for the SOL leg, payer/keeper for the OTC
//! leg) builds the swap instruction off-chain via Jupiter's quote + swap-instructions API and
//! supplies the resulting accounts (`remaining_accounts`) + raw instruction data verbatim. This
//! module only pins the Jupiter program id and enforces `min_out` via a balance-delta check on
//! the destination token account (before vs. after `invoke_signed`) — trustless regardless of
//! which route was taken, since it never trusts Jupiter's own in-band slippage parameters.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::constants::*;
use crate::errors::HubError;

fn read_token_amount(ai: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*ai.owner, TOKEN_PROGRAM_ID, HubError::InvalidTokenAccount);
    let data = ai.try_borrow_data()?;
    require!(
        data.len() == TOKEN_ACCOUNT_LEN,
        HubError::InvalidTokenAccount
    );
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

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

/// Executes a Jupiter route CPI (`route_accounts`/`data` assembled off-chain) and enforces
/// `dest.amount_after − dest.amount_before ≥ min_out` — trustless regardless of route
/// composition, since it never inspects `data` itself. Returns the amount actually received.
///
/// Known limitation (documented, same posture as `raydium_cpswap.rs`'s "verify on devnet"
/// note): this program cannot verify that `data`'s baked-in "amount in" matches the amount the
/// caller intended to swap; a mismatch either fails the CPI (insufficient source balance) or
/// leaves a remainder in the source account, which simply rolls into the next swap. It cannot
/// under-deliver `min_out` silently — that's enforced here independently of `data`.
pub fn swap_exact_in<'info>(
    jupiter_program: &AccountInfo<'info>,
    route_accounts: &[AccountInfo<'info>],
    data: Vec<u8>,
    dest: &AccountInfo<'info>,
    min_out: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    require_keys_eq!(
        *jupiter_program.key,
        JUPITER_PROGRAM_ID,
        HubError::WrongJupiterProgram
    );
    require!(!route_accounts.is_empty(), HubError::SwapAccountsMissing);
    let before = read_token_amount(dest)?;
    let ix = Instruction {
        program_id: JUPITER_PROGRAM_ID,
        accounts: metas_from(route_accounts),
        data,
    };
    invoke_signed(&ix, route_accounts, signer_seeds)?;
    let after = read_token_amount(dest)?;
    let received = after
        .checked_sub(before)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(received >= min_out, HubError::SlippageExceeded);
    Ok(received)
}

/// spl-token `SyncNative` — refreshes a wrapped-SOL account's token `amount` to match its
/// lamport balance after a plain System transfer tops it up (the standard SOL-wrap sequence
/// this program uses to fund a Jupiter SOL→$HUB route from the lamport-only pot PDA).
pub fn sync_native<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        TOKEN_PROGRAM_ID,
        HubError::WrongTokenProgram
    );
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*account.key, false)],
        data: vec![TOKEN_IX_SYNC_NATIVE],
    };
    invoke_signed(&ix, &[account.clone()], &[])?;
    Ok(())
}
