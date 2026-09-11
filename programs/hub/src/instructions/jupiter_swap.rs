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
use crate::instructions::otc_pay::is_supported_token_program;

/// Also reused by `treasury::harvest_lp_fees` for its balance-delta fee-harvest accounting, and
/// by `raydium_cpswap::swap_base_input` for hop2's before/after read — both classic-Token
/// (`vault_usdc`, WSOL, $OTC-side legacy mints) and Token-2022 (`vault_hub`/`$HUB`) destinations
/// pass through here, so this must accept either program, not just classic Token — mirrors
/// `otc_pay::token_account_amount`'s dispatch (`>=` rather than `==` for the same reason: a
/// Token-2022 account can carry extension bytes past the base 165-byte layout).
pub(crate) fn read_token_amount(ai: &AccountInfo) -> Result<u64> {
    require!(
        is_supported_token_program(ai.owner),
        HubError::InvalidTokenAccount
    );
    let data = ai.try_borrow_data()?;
    require!(
        data.len() >= TOKEN_ACCOUNT_LEN,
        HubError::InvalidTokenAccount
    );
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

/// Builds the CPI's account metas, forcing `is_signer: true` for any account matching one of
/// `signer_seeds`'s derived PDAs — mirroring how Anchor's own generated CPI helpers (e.g.
/// `token::transfer`'s `Transfer` accounts struct) always hard-code `is_signer: true` for a PDA
/// authority instead of trusting the incoming `AccountInfo::is_signer`.
///
/// This matters because `invoke_signed`'s seed-based signer elevation is scoped to *this* CPI
/// only: a route account's `is_signer` bit, as received via `ctx.remaining_accounts`, reflects
/// what the caller (off-chain) declared for the *outer* `finalize_epoch` / `otc_pay` instruction
/// — which must be `false` for a PDA like `vault` (a PDA can never hold an ed25519 keypair, so a
/// client-declared `is_signer: true` there would make the transaction demand an unobtainable
/// signature before this program ever runs). If this function instead just copied
/// `ai.is_signer` through unchanged, the resulting CPI would assert `is_signer: false` for
/// `vault`, so a route program that itself re-signs for `vault` in a *further* nested CPI (e.g.
/// Jupiter forwarding into an AMM, or `mock_jupiter`'s own inner `TransferChecked`) would hit
/// "Cross-program invocation with unauthorized signer" — the runtime only allows a program to
/// assert a signer it was itself handed as `is_signer: true`, and this fixes it at the source.
fn metas_from(accounts: &[AccountInfo], signer_seeds: &[&[&[u8]]]) -> Result<Vec<AccountMeta>> {
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
        accounts: metas_from(route_accounts, signer_seeds)?,
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
    invoke_signed(&ix, std::slice::from_ref(account), &[])?;
    Ok(())
}
