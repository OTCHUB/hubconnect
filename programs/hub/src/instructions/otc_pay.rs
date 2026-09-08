//! §A4.1 — $OTC as an alternative step-fee currency.
//!
//! `init_otc_payments` / `set_otc_rate` (authority) create and refresh `OtcPayConfig`;
//! `activate_tier_otc` / `upgrade_tier_otc` mirror the SOL instructions but charge
//! `OtcPayConfig::otc_fee(step_fee)` — the SOL fee valued at `otc_per_sol` × the 2× premium —
//! via a spl-token `TransferChecked` into the program-custodied POL reserve. Nothing enters
//! the pot or ops wallet on this path; the tier-state mutation is shared with `tiers.rs`.
//! Raw SPL layouts are read directly (no anchor-spl), matching the mpl-core approach.
//!
//! This module also hosts `burn_checked`, the raw spl-token `BurnChecked` helper both this
//! module's OTC-priced activate/upgrade path and `tiers.rs`'s SOL-priced path use to destroy the
//! $HUB tier cost — it's a generic SPL primitive, not $OTC-specific, but lives beside the other
//! hand-rolled token-program helpers to avoid a third near-empty module.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::require_desk;
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
/// `mint`); `authority` is always a tx signer here (the token account's own owner), never a PDA,
/// so `invoke` (no seeds) would also work, but `invoke_signed` with `&[]` is equivalent and keeps
/// this symmetric with `transfer_checked`.
pub fn burn_checked<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
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
    invoke_signed(&ix, &[account.clone(), mint.clone(), authority.clone()], &[])?;
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

/// Creates the $OTC payment config, disabled and unpriced. The POL reserve is the vault PDA's
/// token account for `Config.otc_mint`, so collected $OTC can only leave through a program
/// instruction (`build_lp(HubOtc)`), never a wallet.
pub fn init_otc_payments(ctx: Context<InitOtcPayments>) -> Result<()> {
    require_token_account(
        &ctx.accounts.pol_account,
        &ctx.accounts.config.otc_mint,
        ctx.accounts.vault.key,
    )?;
    let p = &mut ctx.accounts.otc_pay;
    p.enabled = false;
    p.otc_per_sol = 0;
    p.rate_ts = 0;
    p.premium_bp = OTC_PREMIUM_BP;
    p.pol_account = ctx.accounts.pol_account.key();
    p.total_otc_collected = 0;
    p.bump = ctx.bumps.otc_pay;
    Ok(())
}

#[derive(Accounts)]
pub struct SetOtcRate<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
}

/// Refreshes the $OTC/SOL reference rate and the on/off switch. The premium is not a parameter.
pub fn set_otc_rate(ctx: Context<SetOtcRate>, otc_per_sol: u64, enabled: bool) -> Result<()> {
    require!(otc_per_sol > 0 || !enabled, HubError::ZeroAmount);
    let p = &mut ctx.accounts.otc_pay;
    p.otc_per_sol = otc_per_sol;
    p.enabled = enabled;
    p.rate_ts = Clock::get()?.unix_timestamp;
    emit!(OtcRateSet {
        otc_per_sol,
        enabled,
        ts: p.rate_ts
    });
    Ok(())
}

/// Live, priced and fresh — the gate both payment instructions pass first.
fn require_payable(p: &OtcPayConfig) -> Result<()> {
    require!(
        p.enabled && p.otc_per_sol > 0,
        HubError::OtcPaymentsDisabled
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now.saturating_sub(p.rate_ts) <= OTC_RATE_MAX_AGE_SECS,
        HubError::OtcRateStale
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateTierOtc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner + collection verified in `require_desk`.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $OTC token account (mint/owner verified in handler).
    #[account(mut)]
    pub payer_otc: UncheckedAccount<'info>,
    /// CHECK: POL reserve recorded on OtcPayConfig at init.
    #[account(mut, address = otc_pay.pol_account @ HubError::InvalidTokenAccount)]
    pub pol_account: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler); burned on activation.
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked` / `burn_checked`.
    pub token_program: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = payer, space = 8 + DeskTier::INIT_SPACE,
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump
    )]
    pub desk_tier: Account<'info, DeskTier>,
    pub system_program: Program<'info, System>,
}

/// `activate_tier` paid in $OTC (§A4.1) into any tier `target_tier` (fresh activation, exactly
/// like the SOL path): flat `otc_fee(step_fee(0, target_tier))` + the full $HUB cost of
/// `target_tier`, burned.
pub fn activate_tier_otc(ctx: Context<ActivateTierOtc>, target_tier: u8) -> Result<()> {
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
    require_payable(&ctx.accounts.otc_pay)?;
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
    let p = &mut ctx.accounts.otc_pay;
    let fee = config.step_fee(0, target_tier)?;
    let otc = p.otc_fee(fee)?;
    let hub_cost = config.hub_cost_delta(0, target_tier)?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.pol_account,
        &ctx.accounts.payer,
        otc,
        &[],
    )?;
    p.total_otc_collected = p
        .total_otc_collected
        .checked_add(otc)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_cost,
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
        sol_equivalent_lamports: fee,
        otc_paid: otc,
        otc_per_sol: p.otc_per_sol,
        premium_bp: p.premium_bp,
        hub_burned_units: hub_cost,
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
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_OTC_PAY], bump = otc_pay.bump)]
    pub otc_pay: Account<'info, OtcPayConfig>,
    /// CHECK: matched against config.otc_mint; decimals read for TransferChecked.
    #[account(address = config.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $OTC token account (mint/owner verified in handler).
    #[account(mut)]
    pub payer_otc: UncheckedAccount<'info>,
    /// CHECK: POL reserve recorded on OtcPayConfig at init.
    #[account(mut, address = otc_pay.pol_account @ HubError::InvalidTokenAccount)]
    pub pol_account: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for BurnChecked; supply mutates.
    #[account(mut, address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: payer's $HUB token account (mint/owner verified in handler); burned on upgrade.
    #[account(mut)]
    pub payer_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked` / `burn_checked`.
    pub token_program: UncheckedAccount<'info>,
    #[account(
        mut, seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided @ HubError::TierVoided
    )]
    pub desk_tier: Account<'info, DeskTier>,
}

/// `upgrade_tier` paid in $OTC (§A4.1): flat `otc_fee(step_fee(from, target))` + the $HUB cost
/// difference for `from → target`, burned. Ownership change → void, no charge — identical to
/// the SOL path.
pub fn upgrade_tier_otc(ctx: Context<UpgradeTierOtc>, target_tier: u8) -> Result<()> {
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
    require_payable(&ctx.accounts.otc_pay)?;
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

    let p = &mut ctx.accounts.otc_pay;
    let fee = config.step_fee(from, target_tier)?;
    let otc = p.otc_fee(fee)?;
    let hub_cost = config.hub_cost_delta(from, target_tier)?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_otc,
        &ctx.accounts.otc_mint,
        &ctx.accounts.pol_account,
        &ctx.accounts.payer,
        otc,
        &[],
    )?;
    p.total_otc_collected = p
        .total_otc_collected
        .checked_add(otc)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    burn_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.payer,
        hub_cost,
    )?;

    apply_upgrade(config, t, target_tier)?;
    emit!(TierPaidOtc {
        asset: t.asset_id,
        owner: asset.owner,
        from_tier: from,
        to_tier: target_tier,
        epoch: config.current_epoch,
        sol_equivalent_lamports: fee,
        otc_paid: otc,
        otc_per_sol: p.otc_per_sol,
        premium_bp: p.premium_bp,
        hub_burned_units: hub_cost,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pay(otc_per_sol: u64) -> OtcPayConfig {
        OtcPayConfig {
            enabled: true,
            otc_per_sol,
            rate_ts: 0,
            premium_bp: OTC_PREMIUM_BP,
            pol_account: Pubkey::default(),
            total_otc_collected: 0,
            bump: 0,
        }
    }

    /// 1 SOL = 1,000 OTC (6 dp) → a 0.5 SOL step is 500 OTC of value, charged 2× = 1,000 OTC.
    #[test]
    fn otc_step_is_twice_sol_value() {
        let p = pay(1_000_000_000);
        assert_eq!(p.otc_fee(STEP_FEE_LAMPORTS).unwrap(), 1_000_000_000);
        assert_eq!(p.otc_fee(3 * STEP_FEE_LAMPORTS).unwrap(), 3_000_000_000);
    }

    /// Rounds up: 0.5 SOL at 3 OTC-units/SOL is 1.5 units × 2 = 3 units exactly; at 1 unit/SOL
    /// it is 0.5 × 2 = 1 unit; at 1 unit/SOL for 0.3 SOL → 0.6 → 1 (ceil, not 0).
    #[test]
    fn otc_fee_rounds_up() {
        assert_eq!(pay(3).otc_fee(STEP_FEE_LAMPORTS).unwrap(), 3);
        assert_eq!(pay(1).otc_fee(STEP_FEE_LAMPORTS).unwrap(), 1);
        assert_eq!(pay(1).otc_fee(300_000_000).unwrap(), 1);
        assert_eq!(pay(1).otc_fee(0).unwrap(), 0);
    }

    #[test]
    fn otc_fee_overflow_is_an_error() {
        assert!(pay(u64::MAX).otc_fee(u64::MAX).is_err());
    }
}
