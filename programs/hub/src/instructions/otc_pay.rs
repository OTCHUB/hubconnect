//! §A4.1 (revised) — $OTC as an alternative step-fee currency, now with a real on-chain
//! Jupiter swap-burn leg instead of a static authority-refreshed rate.
//!
//! `init_otc_payments` (authority) creates `OtcPayConfig`; `set_otc_payments_enabled` toggles
//! it on/off. `activate_tier_otc` / `upgrade_tier_otc` charge the *same* flat 0.5 SOL activation
//! fee as the SOL path (90% pot / 10% ops, `book_inflow`'d into the same epoch — see
//! `Config::step_fee`), **plus** a $OTC-denominated 2× premium that replaces the tier's direct
//! $HUB burn entirely (no `payer_hub` debit beyond what the swap itself produces):
//!
//!   - caller supplies `otc_swap_amount` (the $OTC input, sized off-chain via a live Jupiter
//!     quote) which is swapped $OTC→$HUB via `jupiter_swap::swap_exact_in` with
//!     `min_out = hub_cost_delta` — trustlessly enforced on-chain via balance-delta, so the
//!     swap can never under-deliver the tier's own $HUB requirement. The $HUB received lands in
//!     the payer's own `payer_hub` account and is burned there in full immediately after
//!     (bonus burn if the swap cleared better than the floor) — this *is* the tier's burn, real
//!     and dynamic as $HUB's market price moves.
//!   - a second, equal-sized (scaled by `OTC_PAY_SWAP_BURN_PCT_BP`, so re-tuning the split
//!     carries through automatically) $OTC amount is charged again and injected straight into
//!     `OtcPotState.otc_vault` — no swap, exactly `clear_creator_fees`'s 80% desk-pot leg
//!     (`creator_fee.rs`): it only raises `total_otc_bought_units`, never
//!     `total_lamports_spent`, mechanically lifting the lifetime average buy rate `claim_yield`
//!     prices every desk's yield at.
//!
//! Economic parity note carried over from the prior design: unlike the SOL path, the $OTC leg
//! cannot credit `Pot`/`Epoch` directly — `pot` is a system-owned lamport PDA and `book_inflow`
//! books *lamports*, so crediting it from a token transfer that deposits no real lamports would
//! create liability the pot never received, breaking `assert_pot_solvent` for every other desk's
//! yield claim. Only the flat SOL fee (real lamports) is booked as pot inflow; the $OTC premium's
//! desk-pot leg is the direct, swap-free `OtcPotState` injection described above.
//!
//! This module also hosts `transfer_checked` / `burn_checked`, the raw spl-token helpers this
//! module's $OTC-priced path, `tiers.rs`'s SOL-priced path, and `epochs.rs`'s synchronous
//! round-split swap all share to move/destroy tokens — generic SPL primitives, not
//! $OTC-specific, but kept beside `require_token_account` to avoid a third near-empty module.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::jupiter_swap;
use crate::instructions::mpl_core::require_desk;
use crate::instructions::pot::{add, book_inflow, bps_of, sub, transfer_from_signer};
use crate::instructions::tiers::{
    apply_activation, apply_upgrade, require_activatable, settle_for_upgrade, void_tier,
};
use crate::state::*;

/// spl-token `Account` prefix: mint 32 · owner 32 · amount u64.
pub struct TokenAccountView {
    pub mint: Pubkey,
    pub owner: Pubkey,
}

pub fn read_token_account(ai: &AccountInfo) -> Result<TokenAccountView> {
    require_keys_eq!(*ai.owner, TOKEN_PROGRAM_ID, HubError::InvalidTokenAccount);
    let data = ai.try_borrow_data()?;
    require!(
        data.len() == TOKEN_ACCOUNT_LEN,
        HubError::InvalidTokenAccount
    );
    Ok(TokenAccountView {
        mint: Pubkey::new_from_array(data[0..32].try_into().unwrap()),
        owner: Pubkey::new_from_array(data[32..64].try_into().unwrap()),
    })
}

/// Token account must hold `mint` for `owner`.
pub fn require_token_account(ai: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> Result<()> {
    let v = read_token_account(ai)?;
    require!(
        v.mint == *mint && v.owner == *owner,
        HubError::InvalidTokenAccount
    );
    Ok(())
}

fn mint_decimals(mint: &AccountInfo) -> Result<u8> {
    require_keys_eq!(*mint.owner, TOKEN_PROGRAM_ID, HubError::WrongTokenProgram);
    let data = mint.try_borrow_data()?;
    require!(
        data.len() > MINT_DECIMALS_OFFSET,
        HubError::WrongTokenProgram
    );
    Ok(data[MINT_DECIMALS_OFFSET])
}

/// spl-token `TransferChecked { amount, decimals }`. `authority` is either a tx signer
/// (`signer_seeds = &[]`) or a program PDA whose seeds are supplied.
pub fn transfer_checked<'info>(
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
        HubError::WrongTokenProgram
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

/// spl-token `BurnChecked { amount, decimals }` — destroys `amount` from `account` (mint =
/// `mint`). `authority` is either a tx signer (`signer_seeds = &[]` — the token account's own
/// owner, e.g. a payer burning their own $HUB in `tiers.rs`) or a program PDA whose seeds are
/// supplied (e.g. the `["vault"]` PDA burning $HUB received from a Jupiter swap it owns).
pub fn burn_checked<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        TOKEN_PROGRAM_ID,
        HubError::WrongTokenProgram
    );
    let decimals = mint_decimals(mint)?;
    let mut data = Vec::with_capacity(10);
    data.push(TOKEN_IX_BURN_CHECKED);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*account.key, false),
            AccountMeta::new(*mint.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[account.clone(), mint.clone(), authority.clone()],
        signer_seeds,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitOtcPayments<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; must own `pol_account`.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.otc_mint, owner = vault (verified in handler).
    pub pol_account: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + OtcPayConfig::INIT_SPACE, seeds = [SEED_OTC_PAY], bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
    pub system_program: Program<'info, System>,
}

/// Creates the $OTC payment config, disabled. Pricing is no longer a static rate — the 2×
/// premium's swap-burn leg is a live Jupiter quote, so there is nothing to refresh here anymore.
/// The POL reserve is the vault PDA's token account for `Config.otc_mint`, so collected $OTC can
/// only leave through a program instruction (`build_lp(HubOtc)`), never a wallet.
pub fn init_otc_payments(ctx: Context<InitOtcPayments>) -> Result<()> {
    require_token_account(
        &ctx.accounts.pol_account,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.vault.key,
    )?;
    let p = &mut ctx.accounts.otc_pay;
    p.enabled = false;
    p.pol_account = ctx.accounts.pol_account.key();
    p.total_otc_collected = 0;
    p.bump = ctx.bumps.otc_pay;
    Ok(())
}

#[derive(Accounts)]
pub struct SetOtcPaymentsEnabled<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
}

/// On/off switch only — pricing is a live Jupiter quote supplied per-call, not a stored rate.
pub fn set_otc_payments_enabled(ctx: Context<SetOtcPaymentsEnabled>, enabled: bool) -> Result<()> {
    ctx.accounts.otc_pay.enabled = enabled;
    emit!(OtcPaymentsEnabledSet { enabled });
    Ok(())
}

/// `otc_paid_total = otc_swap_amount × BPS_DENOMINATOR / OTC_PAY_SWAP_BURN_PCT_BP`; the desk-pot
/// leg is the remainder — generalized so a future re-tune of the swap/pot split (currently an
/// even 50/50) carries through without touching call sites.
fn otc_pot_leg(otc_swap_amount: u64) -> Result<(u64, u64)> {
    let otc_paid_total = u64::try_from(
        (otc_swap_amount as u128) * (BPS_DENOMINATOR as u128)
            / (OTC_PAY_SWAP_BURN_PCT_BP as u128),
    )
    .map_err(|_| error!(HubError::MathOverflow))?;
    let to_otc_pot = sub(otc_paid_total, otc_swap_amount)?;
    Ok((otc_paid_total, to_otc_pot))
}

#[derive(Accounts)]
pub struct ActivateTierOtc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner + collection verified in `require_desk`.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: system-owned lamport vault PDA. Destination of the flat 0.5 SOL fee's pot leg.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: matched against config.ops_wallet. Destination of the flat fee's ops leg.
    #[account(mut, address = config.ops_wallet @ HubError::Unauthorized)]
    pub ops_wallet: UncheckedAccount<'info>,
    #[account(seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $OTC token account (mint/owner verified in handler) — source of both the
    /// desk-pot leg transfer and the Jupiter swap-burn leg (as part of `remaining_accounts`).
    #[account(mut)]
    pub payer_otc: UncheckedAccount<'info>,
    /// §A5 yield-vault bookkeeping; the desk-pot leg's `total_otc_bought_units` is credited here.
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Account<'info, OtcPotState>,
    /// CHECK: $OTC vault recorded on OtcPotState at init; owner = `["pot"]` PDA. Destination of
    /// the desk-pot leg (no swap — already $OTC).
    #[account(mut, address = otc_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler) — the Jupiter swap's
    /// destination; burned in full immediately after (this *is* the tier's $HUB cost burn).
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in the token-program helpers.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: pinned to `JUPITER_PROGRAM_ID` in `jupiter_swap::swap_exact_in`.
    pub jupiter_program: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = payer, space = 8 + DeskTier::INIT_SPACE,
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump
    )]
    pub desk_tier: Account<'info, DeskTier>,
    pub system_program: Program<'info, System>,
}

/// `activate_tier` paid in $OTC (§A4.1, revised) into any tier `target_tier` (fresh activation,
/// exactly like the SOL path): the same flat 0.5 SOL fee (90% pot / 10% ops) **plus** the $OTC
/// 2× premium — `otc_swap_amount` swapped $OTC→$HUB via Jupiter (`min_out = hub_cost_delta`,
/// received $HUB burned in full) and an equal-scaled amount injected into the desk-pot (see
/// module doc). `jupiter_data`/`ctx.remaining_accounts` are the caller-assembled Jupiter route;
/// `payer` signs directly (no PDA involved), so `signer_seeds = &[]` throughout.
pub fn activate_tier_otc<'info>(
    ctx: Context<'info, ActivateTierOtc<'info>>,
    target_tier: u8,
    otc_swap_amount: u64,
    jupiter_data: Vec<u8>,
) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.payer.key(),
        HubError::NotDeskOwner
    );
    let t = &mut ctx.accounts.desk_tier;
    require_activatable(t)?;
    require!(ctx.accounts.otc_pay.enabled, HubError::OtcPaymentsDisabled);
    require!(otc_swap_amount > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.payer_otc,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.payer.key,
    )?;
    require_token_account(
        &ctx.accounts.payer_hub,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.payer.key,
    )?;

    let config = &mut ctx.accounts.config;
    let fee = config.step_fee(0, target_tier)?;
    let hub_cost = config.hub_cost_delta(0, target_tier)?;
    let to_ops = bps_of(fee, config.ops_pct_bp)?;
    let to_pot = sub(fee, to_ops)?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.pot,
        to_pot,
    )?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.ops_wallet,
        to_ops,
    )?;
    book_inflow(config, &mut ctx.accounts.epoch, to_pot)?;

    let (otc_paid_total, to_otc_pot) = otc_pot_leg(otc_swap_amount)?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.otc_vault,
        &ctx.accounts.payer,
        to_otc_pot,
        &[],
    )?;
    let otc_pot = &mut ctx.accounts.otc_pot;
    otc_pot.total_otc_bought_units = add(otc_pot.total_otc_bought_units, to_otc_pot)?;
    let p = &mut ctx.accounts.otc_pay;
    p.total_otc_collected = add(p.total_otc_collected, otc_paid_total)?;

    let hub_received = jupiter_swap::swap_exact_in(
        &ctx.accounts.jupiter_program,
        ctx.remaining_accounts,
        jupiter_data,
        &ctx.accounts.payer_hub,
        hub_cost,
        &[],
    )?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_received,
        &[],
    )?;

    let epoch = apply_activation(
        config,
        t,
        ctx.accounts.desk_asset.key(),
        asset.owner,
        target_tier,
        ctx.bumps.desk_tier,
    )?;
    emit!(TierPaidOtc {
        asset: t.asset_id,
        owner: asset.owner,
        from_tier: 0,
        to_tier: target_tier,
        epoch,
        fee_lamports: fee,
        to_pot,
        to_ops,
        otc_swap_amount,
        hub_burned_units: hub_received,
        to_otc_pot,
        otc_paid_total,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpgradeTierOtc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; ownership re-verified here (lazy revocation).
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    /// CHECK: system-owned lamport vault PDA. Destination of the flat 0.5 SOL fee's pot leg.
    #[account(mut, seeds = [SEED_POT], bump = config.pot_bump)]
    pub pot: UncheckedAccount<'info>,
    /// CHECK: matched against config.ops_wallet. Destination of the flat fee's ops leg.
    #[account(mut, address = config.ops_wallet @ HubError::Unauthorized)]
    pub ops_wallet: UncheckedAccount<'info>,
    #[account(seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Box<Account<'info, OtcPayConfig>>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $OTC token account (mint/owner verified in handler) — source of both the
    /// desk-pot leg transfer and the Jupiter swap-burn leg (as part of `remaining_accounts`).
    #[account(mut)]
    pub payer_otc: UncheckedAccount<'info>,
    /// §A5 yield-vault bookkeeping; the desk-pot leg's `total_otc_bought_units` is credited here.
    #[account(mut, seeds = [SEED_OTC_POT], bump = otc_pot.bump)]
    pub otc_pot: Box<Account<'info, OtcPotState>>,
    /// CHECK: $OTC vault recorded on OtcPotState at init; owner = `["pot"]` PDA. Destination of
    /// the desk-pot leg (no swap — already $OTC).
    #[account(mut, address = otc_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler) — the Jupiter swap's
    /// destination; burned in full immediately after (this *is* the tier's $HUB cost burn).
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in the token-program helpers.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: pinned to `JUPITER_PROGRAM_ID` in `jupiter_swap::swap_exact_in`.
    pub jupiter_program: UncheckedAccount<'info>,
    #[account(
        mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided @ HubError::TierVoided
    )]
    pub desk_tier: Box<Account<'info, DeskTier>>,
    pub system_program: Program<'info, System>,
}

/// `upgrade_tier` paid in $OTC (§A4.1, revised): the same flat `step_fee` (90% pot / 10% ops)
/// **plus** the $OTC 2× premium priced off `hub_cost_delta` for `from → target_tier` (see
/// `activate_tier_otc` and the module doc for the swap-burn/desk-pot split). Ownership change →
/// void, no charge — identical to the SOL path.
pub fn upgrade_tier_otc<'info>(
    ctx: Context<'info, UpgradeTierOtc<'info>>,
    target_tier: u8,
    otc_swap_amount: u64,
    jupiter_data: Vec<u8>,
) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    let config = &mut ctx.accounts.config;
    let t = &mut ctx.accounts.desk_tier;
    if asset.owner != t.owner_at_activation {
        return void_tier(config, t, asset.owner);
    }
    require_keys_eq!(
        asset.owner,
        ctx.accounts.payer.key(),
        HubError::NotDeskOwner
    );
    require!(ctx.accounts.otc_pay.enabled, HubError::OtcPaymentsDisabled);
    require!(otc_swap_amount > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.payer_otc,
        &config.otc_mint,
        ctx.accounts.payer.key,
    )?;
    require_token_account(
        &ctx.accounts.payer_hub,
        &config.hub_mint,
        ctx.accounts.payer.key,
    )?;
    let from = settle_for_upgrade(config, t)?;

    let fee = config.step_fee(from, target_tier)?;
    let hub_cost = config.hub_cost_delta(from, target_tier)?;
    let to_ops = bps_of(fee, config.ops_pct_bp)?;
    let to_pot = sub(fee, to_ops)?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.pot,
        to_pot,
    )?;
    transfer_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.payer,
        &ctx.accounts.ops_wallet,
        to_ops,
    )?;
    book_inflow(config, &mut ctx.accounts.epoch, to_pot)?;

    let (otc_paid_total, to_otc_pot) = otc_pot_leg(otc_swap_amount)?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.otc_vault,
        &ctx.accounts.payer,
        to_otc_pot,
        &[],
    )?;
    let otc_pot = &mut ctx.accounts.otc_pot;
    otc_pot.total_otc_bought_units = add(otc_pot.total_otc_bought_units, to_otc_pot)?;
    let p = &mut ctx.accounts.otc_pay;
    p.total_otc_collected = add(p.total_otc_collected, otc_paid_total)?;

    let hub_received = jupiter_swap::swap_exact_in(
        &ctx.accounts.jupiter_program,
        ctx.remaining_accounts,
        jupiter_data,
        &ctx.accounts.payer_hub,
        hub_cost,
        &[],
    )?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_received,
        &[],
    )?;

    apply_upgrade(config, t, target_tier)?;
    emit!(TierPaidOtc {
        asset: t.asset_id,
        owner: asset.owner,
        from_tier: from,
        to_tier: target_tier,
        epoch: config.current_epoch,
        fee_lamports: fee,
        to_pot,
        to_ops,
        otc_swap_amount,
        hub_burned_units: hub_received,
        to_otc_pot,
        otc_paid_total,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `OTC_PAY_SWAP_BURN_PCT_BP` is 50%, so the desk-pot leg is exactly the swap leg's size and
    /// the total charged is exactly 2× the swap-burn leg — the "2× premium".
    #[test]
    fn otc_pot_leg_is_symmetric_2x_premium() {
        let (total, to_pot) = otc_pot_leg(1_000_000).unwrap();
        assert_eq!(total, 2_000_000);
        assert_eq!(to_pot, 1_000_000);
    }

    /// Odd amounts still balance exactly: `otc_swap_amount + to_otc_pot == otc_paid_total`.
    #[test]
    fn otc_pot_leg_balances_for_odd_amounts() {
        let swap = 1_234_567u64;
        let (total, to_pot) = otc_pot_leg(swap).unwrap();
        assert_eq!(swap + to_pot, total);
    }

    #[test]
    fn otc_pot_leg_zero_is_zero() {
        let (total, to_pot) = otc_pot_leg(0).unwrap();
        assert_eq!(total, 0);
        assert_eq!(to_pot, 0);
    }

    #[test]
    fn otc_pot_leg_overflow_is_an_error() {
        assert!(otc_pot_leg(u64::MAX).is_err());
    }
}
