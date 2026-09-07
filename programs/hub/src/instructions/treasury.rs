//! §B3 #11 consign_desk, #12 unconsign_desk, #13 build_lp.
//!
//! Consigned desks are custodied by the program-signed `["vault"]` PDA so withdrawal
//! is permissionless for the consignor (trust-minimised) — the treasury never holds
//! the key to an owner's desk.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::{require_desk, transfer_v1};
use crate::state::*;

#[derive(Accounts)]
pub struct ConsignDesk<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner verified, then transferred via Core CPI.
    #[account(mut)]
    pub desk_asset: UncheckedAccount<'info>,
    /// CHECK: Core collection the asset belongs to (required by TransferV1).
    #[account(address = config.desk_collection @ HubError::WrongCollection)]
    pub desk_collection: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        constraint = !config.paused @ HubError::Paused,
        constraint = config.consignment_enabled @ HubError::ConsignmentDisabled
    )]
    pub config: Account<'info, Config>,
    /// CHECK: program-signed custody PDA recorded on TreasuryState.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    #[account(
        init_if_needed, payer = owner, space = 8 + ConsignedDesk::INIT_SPACE,
        seeds = [SEED_CONSIGN, desk_asset.key().as_ref()], bump
    )]
    pub consigned_desk: Account<'info, ConsignedDesk>,
    /// CHECK: Metaplex Core program id, asserted in `transfer_v1`.
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn consign_desk(ctx: Context<ConsignDesk>) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.owner.key(),
        HubError::NotDeskOwner
    );
    let cd = &mut ctx.accounts.consigned_desk;
    require!(!cd.active, HubError::AlreadyConsigned);

    transfer_v1(
        &ctx.accounts.mpl_core_program,
        &ctx.accounts.desk_asset,
        &ctx.accounts.desk_collection,
        &ctx.accounts.owner,
        &ctx.accounts.owner,
        &ctx.accounts.vault,
        &ctx.accounts.system_program.to_account_info(),
        &[],
    )?;

    let epoch = ctx.accounts.config.current_epoch;
    cd.asset_id = ctx.accounts.desk_asset.key();
    cd.consignor = ctx.accounts.owner.key();
    cd.consigned_epoch = epoch;
    cd.active = true;
    cd.bump = ctx.bumps.consigned_desk;
    let ts = &mut ctx.accounts.treasury_state;
    ts.desks_consigned = ts.desks_consigned.saturating_add(1);

    emit!(DeskConsigned {
        asset: cd.asset_id,
        consignor: cd.consignor,
        epoch
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UnconsignDesk<'info> {
    #[account(mut)]
    pub consignor: Signer<'info>,
    /// CHECK: Metaplex Core asset returned via Core CPI signed by the vault PDA.
    #[account(mut)]
    pub desk_asset: UncheckedAccount<'info>,
    /// CHECK: Core collection the asset belongs to (required by TransferV1).
    #[account(address = config.desk_collection @ HubError::WrongCollection)]
    pub desk_collection: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// The consignment epoch must be closed so no round is double-counted (§A6.1).
    #[account(
        seeds = [SEED_EPOCH, &consigned_desk.consigned_epoch.to_le_bytes()], bump = consign_epoch.bump,
        constraint = consign_epoch.finalized @ HubError::UnconsignBeforeFinalize
    )]
    pub consign_epoch: Account<'info, Epoch>,
    /// CHECK: program-signed custody PDA.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    #[account(
        mut, seeds = [SEED_CONSIGN, desk_asset.key().as_ref()], bump = consigned_desk.bump,
        has_one = consignor @ HubError::Unauthorized,
        constraint = consigned_desk.active @ HubError::ConsignmentInactive
    )]
    pub consigned_desk: Account<'info, ConsignedDesk>,
    /// CHECK: Metaplex Core program id, asserted in `transfer_v1`.
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn unconsign_desk(ctx: Context<UnconsignDesk>) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.vault.key(),
        HubError::NotDeskOwner
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];
    transfer_v1(
        &ctx.accounts.mpl_core_program,
        &ctx.accounts.desk_asset,
        &ctx.accounts.desk_collection,
        &ctx.accounts.consignor,
        &ctx.accounts.vault,
        &ctx.accounts.consignor,
        &ctx.accounts.system_program.to_account_info(),
        &[seeds],
    )?;

    let cd = &mut ctx.accounts.consigned_desk;
    cd.active = false;
    let ts = &mut ctx.accounts.treasury_state;
    ts.desks_consigned = ts.desks_consigned.saturating_sub(1);

    emit!(DeskUnconsigned {
        asset: cd.asset_id,
        consignor: cd.consignor,
        epoch: ctx.accounts.config.current_epoch,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LpPair {
    HubSol,
    HubOtc,
}

#[derive(Accounts)]
pub struct BuildLp<'info> {
    pub treasury: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG], bump = config.bump,
        has_one = treasury @ HubError::Unauthorized,
        constraint = config.lp_enabled @ HubError::LpDisabled
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: treasury LP-token custody PDA (`["vault"]`); withdraw path never sells HUB.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub lp_vault: UncheckedAccount<'info>,
    // AMM pool accounts arrive as remaining_accounts once the graduation AMM is fixed (§A6.2).
}

/// Gates + position bookkeeping. The AMM deposit CPI is adapter-specific and lands
/// once the launch AMM is known; until then the instruction records intent only when
/// pool accounts are supplied, and rejects otherwise so no state drifts from reality.
pub fn build_lp(
    ctx: Context<BuildLp>,
    pair: LpPair,
    hub_amount: u64,
    quote_amount: u64,
) -> Result<()> {
    require!(hub_amount > 0 && quote_amount > 0, HubError::ZeroAmount);
    let config = &ctx.accounts.config;
    let ts = &mut ctx.accounts.treasury_state;
    match pair {
        LpPair::HubSol => require!(!ts.lp_hub_sol_active, HubError::LpPositionExists),
        LpPair::HubOtc => {
            let now = Clock::get()?.unix_timestamp;
            require!(
                config.lp_phase2_open_ts > 0 && now >= config.lp_phase2_open_ts,
                HubError::LpPhase2Gated
            );
            require!(!ts.lp_hub_otc_active, HubError::LpPositionExists);
        }
    }
    require!(!ctx.remaining_accounts.is_empty(), HubError::NotImplemented);

    match pair {
        LpPair::HubSol => ts.lp_hub_sol_active = true,
        LpPair::HubOtc => ts.lp_hub_otc_active = true,
    }
    ts.lp_hub_deposited = ts
        .lp_hub_deposited
        .checked_add(hub_amount)
        .ok_or(HubError::MathOverflow)?;
    ts.lp_quote_deposited = ts
        .lp_quote_deposited
        .checked_add(quote_amount)
        .ok_or(HubError::MathOverflow)?;
    emit!(LpBuilt {
        pair: pair as u8,
        hub_amount,
        quote_amount
    });
    Ok(())
}
