//! Mock Jupiter V6 CPI target — **devnet/localnet testing only**. Implements the minimal swap
//! interface `hub`'s `jupiter_swap::swap_exact_in` invokes (arbitrary route accounts + raw
//! instruction data, `min_out` enforced by the *caller* via balance-delta) so `finalize_epoch`,
//! `activate_tier_otc`, and `upgrade_tier_otc` can be exercised end-to-end without live Jupiter
//! liquidity for $HUB/$OTC — which doesn't exist yet on mainnet, and can never exist on devnet at
//! all (Jupiter v6 is only deployed on mainnet-beta; see `hub`'s `constants::JUPITER_PROGRAM_ID`
//! doc comment and `Anchor.toml`'s mainnet-fork localnet note).
//!
//! Deployed under its own program id — **never** under the real Jupiter program id. `hub` only
//! ever calls into this program when built with its `mock-jupiter` Cargo feature (see
//! `programs/hub/src/constants.rs`); the default/production build — and every mainnet
//! deploy/verify (`scripts/verify-build.sh`, `.github/workflows/verify.yml`) — is untouched and
//! still pins the real Jupiter aggregator.
//!
//! Mechanics: pulls `amount_in` of the source mint from the caller-supplied source account into
//! this program's own liquidity reserve for that mint, then pays `amount_out` of the destination
//! mint out of its liquidity reserve for that mint to the caller-supplied destination account.
//! Both reserves are plain ATAs owned by the `mock_authority` PDA below, pre-funded once by
//! `scripts/mock-jupiter-setup.ts` — no mint authority over the real devnet $HUB/$OTC mints is
//! required or touched, and nothing here ever runs against mainnet-beta.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

declare_id!("BvjZ2YNTxKmKKKWUiNNRG83tQr5djiMMPBAGJxiZZn5C");

pub const SEED_MOCK_AUTHORITY: &[u8] = b"mock_authority";

const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_IX_TRANSFER_CHECKED: u8 = 12;
const MINT_DECIMALS_OFFSET: usize = 44;

#[error_code]
pub enum MockJupiterError {
    #[msg("account is not owned by the classic SPL Token program")]
    WrongTokenProgram,
}

fn mint_decimals(mint: &AccountInfo) -> Result<u8> {
    require_keys_eq!(
        *mint.owner,
        TOKEN_PROGRAM_ID,
        MockJupiterError::WrongTokenProgram
    );
    let data = mint.try_borrow_data()?;
    require!(
        data.len() > MINT_DECIMALS_OFFSET,
        MockJupiterError::WrongTokenProgram
    );
    Ok(data[MINT_DECIMALS_OFFSET])
}

/// spl-token `TransferChecked { amount, decimals }` — mirrors `hub`'s own hand-rolled helper
/// (`instructions/otc_pay.rs::transfer_checked`) so this crate needs no anchor-spl dependency.
fn transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        TOKEN_PROGRAM_ID,
        MockJupiterError::WrongTokenProgram
    );
    let decimals = mint_decimals(mint)?;
    let mut data = Vec::with_capacity(10);
    data.push(TOKEN_IX_TRANSFER_CHECKED);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[from.clone(), mint.clone(), to.clone(), authority.clone()],
        signer_seeds,
    )?;
    Ok(())
}

#[program]
pub mod mock_jupiter {
    use super::*;

    /// Simulates one Jupiter route: `amount_in` of `source_mint` leaves
    /// `source_token_account` (its authority must be a real tx signer, or a PDA the *caller*
    /// already `invoke_signed`s for — exactly how `hub`'s real route accounts already arrive at
    /// this point, so no extra signing logic is needed here); in exchange, `amount_out` of
    /// `destination_mint` is paid to `destination_token_account` out of this program's
    /// pre-funded liquidity reserve. `hub`'s own `jupiter_swap::swap_exact_in` independently
    /// verifies the destination balance rose by at least its `min_out` via balance-delta, so
    /// slippage protection is exercised the same way it would be against real Jupiter.
    pub fn mock_swap(ctx: Context<MockSwap>, amount_in: u64, amount_out: u64) -> Result<()> {
        let bump = ctx.bumps.mock_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[SEED_MOCK_AUTHORITY, &[bump]]];

        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.source_token_account,
            &ctx.accounts.source_mint,
            &ctx.accounts.liquidity_in,
            &ctx.accounts.source_authority,
            amount_in,
            &[],
        )?;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.liquidity_out,
            &ctx.accounts.destination_mint,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.mock_authority,
            amount_out,
            signer_seeds,
        )?;
        Ok(())
    }

    /// Mock target for `hub`'s `raydium_cpswap::swap_base_input` hop2 CPI
    /// (`RAYDIUM_CP_SWAP_PROGRAM_ID` redirects here under the `mock-jupiter` feature — see
    /// `programs/hub/src/constants.rs`). Named `swap_base_input`, not an arbitrary mock name,
    /// purely so Anchor's own global-instruction-discriminator hash
    /// (`sha256("global:swap_base_input")[..8]`) lands on the exact same 8 bytes hub hand-rolls
    /// as `RAYDIUM_IX_SWAP_BASE_INPUT` — no dispatch table needed on either side. Reuses
    /// `MockSwap`'s account layout/mechanics verbatim (see `mock_swap` above); the only
    /// difference is the argument name (`minimum_amount_out`, matching Raydium's real
    /// interface) is treated as the *exact* amount delivered, same "mock has no pool curve, the
    /// caller states the outcome directly" convention `mock_swap`'s `amount_out` already uses.
    pub fn swap_base_input(
        ctx: Context<MockSwap>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        mock_swap(ctx, amount_in, minimum_amount_out)
    }
}

#[derive(Accounts)]
pub struct MockSwap<'info> {
    /// CHECK: owner/authority of `source_token_account` — a real wallet already a signer on the
    /// outer tx (OTC-pay path) or a `hub` PDA that `hub` itself `invoke_signed`s for (SOL-pot
    /// legs); forwarded through `hub`'s CPI exactly as `jupiter_swap::swap_exact_in` receives it.
    pub source_authority: UncheckedAccount<'info>,
    /// CHECK: mint/owner asserted inside `transfer_checked`.
    #[account(mut)]
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK: decimals read inside `transfer_checked`.
    pub source_mint: UncheckedAccount<'info>,
    /// CHECK: mint/owner asserted inside `transfer_checked`.
    #[account(mut)]
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: decimals read inside `transfer_checked`.
    pub destination_mint: UncheckedAccount<'info>,
    /// CHECK: this program's pre-funded liquidity reserve for the source mint (an ATA owned by
    /// `mock_authority`) — receives `amount_in`. Funded once by
    /// `scripts/mock-jupiter-setup.ts`. Left as `UncheckedAccount` (mint/owner asserted inside
    /// `transfer_checked` instead of via a typed Anchor constraint) so this devnet-only crate
    /// needs no anchor-spl dependency, matching `hub`'s own zero-vendored-IDL style.
    #[account(mut)]
    pub liquidity_in: UncheckedAccount<'info>,
    /// CHECK: this program's pre-funded liquidity reserve for the destination mint — pays out
    /// `amount_out`. See `liquidity_in`.
    #[account(mut)]
    pub liquidity_out: UncheckedAccount<'info>,
    /// CHECK: PDA authority over both liquidity reserves; never holds data.
    #[account(seeds = [SEED_MOCK_AUTHORITY], bump)]
    pub mock_authority: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted inside `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}
