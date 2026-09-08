//! §A5.1 — HUB Pot: the MemeStock basket ($OTC, CRCLx, OpenAI, Anthropic) reward, funded by the
//! treasury's converted source-B (13-stock treasury-desk) yield. Mirrors `tokenomics.rs`'s
//! `fund_treasury_reward` / `open_reward_round` / `distribute_treasury_reward` trio exactly,
//! generalized from 1 mint to 4 — independent bookkeeping, independent vaults, independent
//! funding source. See docs/hubconnect-spec.md §A5.1.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::require_desk;
use crate::instructions::otc_pay::{require_token_account, transfer_checked};
use crate::instructions::tokenomics::reward_share;
use crate::state::*;

#[derive(Accounts)]
pub struct InitHubPot<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; must own all 4 bucket vaults below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = otc_mint, owner = vault (verified in handler).
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = crclx_mint, owner = vault (verified in handler).
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = openai_mint, owner = vault (verified in handler).
    pub openai_vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = anthropic_mint, owner = vault (verified in handler).
    pub anthropic_vault: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + HubPotConfig::INIT_SPACE, seeds = [SEED_HUB_POT], bump)]
    pub hub_pot: Account<'info, HubPotConfig>,
    pub system_program: Program<'info, System>,
}

/// Records the 4 basket mints (resolved at init, never hardcoded — §A2) + their vault-owned
/// token accounts. One-time, post-`initialize_config`, same no-migration pattern as
/// `init_otc_pot` / `init_creator_fee_state`.
pub fn init_hub_pot(
    ctx: Context<InitHubPot>,
    otc_mint: Pubkey,
    crclx_mint: Pubkey,
    openai_mint: Pubkey,
    anthropic_mint: Pubkey,
) -> Result<()> {
    require_token_account(&ctx.accounts.otc_vault, &otc_mint, ctx.accounts.vault.key)?;
    require_token_account(&ctx.accounts.crclx_vault, &crclx_mint, ctx.accounts.vault.key)?;
    require_token_account(&ctx.accounts.openai_vault, &openai_mint, ctx.accounts.vault.key)?;
    require_token_account(
        &ctx.accounts.anthropic_vault,
        &anthropic_mint,
        ctx.accounts.vault.key,
    )?;
    let p = &mut ctx.accounts.hub_pot;
    p.otc_mint = otc_mint;
    p.crclx_mint = crclx_mint;
    p.openai_mint = openai_mint;
    p.anthropic_mint = anthropic_mint;
    p.otc_vault = ctx.accounts.otc_vault.key();
    p.crclx_vault = ctx.accounts.crclx_vault.key();
    p.openai_vault = ctx.accounts.openai_vault.key();
    p.anthropic_vault = ctx.accounts.anthropic_vault.key();
    p.bump = ctx.bumps.hub_pot;
    Ok(())
}

#[derive(Accounts)]
pub struct FundHubPot<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Account<'info, HubPotConfig>,
    /// CHECK: matched against hub_pot.otc_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.crclx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.crclx_mint @ HubError::InvalidTokenAccount)]
    pub crclx_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.openai_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.openai_mint @ HubError::InvalidTokenAccount)]
    pub openai_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.anthropic_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.anthropic_mint @ HubError::InvalidTokenAccount)]
    pub anthropic_mint: UncheckedAccount<'info>,
    /// CHECK: treasury's $OTC source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_otc: UncheckedAccount<'info>,
    /// CHECK: treasury's CRCLx source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_crclx: UncheckedAccount<'info>,
    /// CHECK: treasury's OpenAI-stock source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_openai: UncheckedAccount<'info>,
    /// CHECK: treasury's Anthropic-stock source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_anthropic: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.openai_vault @ HubError::InvalidTokenAccount)]
    pub openai_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.anthropic_vault @ HubError::InvalidTokenAccount)]
    pub anthropic_vault: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}

/// Treasury deposits the four already-converted basket amounts (swapped off-chain by the
/// keeper from source-B's 13-stock claim, per §A5.1) in one instruction. Each leg is an
/// enforced `TransferChecked`, not merely attested (mirrors `fund_treasury_reward`); a
/// zero-amount leg is skipped rather than rejected, since not every fund cycle need touch
/// every bucket evenly.
pub fn fund_hub_pot(
    ctx: Context<FundHubPot>,
    otc_amount: u64,
    crclx_amount: u64,
    openai_amount: u64,
    anthropic_amount: u64,
) -> Result<()> {
    require!(
        otc_amount > 0 || crclx_amount > 0 || openai_amount > 0 || anthropic_amount > 0,
        HubError::ZeroAmount
    );
    let legs: [(u64, &UncheckedAccount, &UncheckedAccount, &UncheckedAccount); 4] = [
        (
            otc_amount,
            &ctx.accounts.treasury_otc,
            &ctx.accounts.otc_mint,
            &ctx.accounts.otc_vault,
        ),
        (
            crclx_amount,
            &ctx.accounts.treasury_crclx,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.crclx_vault,
        ),
        (
            openai_amount,
            &ctx.accounts.treasury_openai,
            &ctx.accounts.openai_mint,
            &ctx.accounts.openai_vault,
        ),
        (
            anthropic_amount,
            &ctx.accounts.treasury_anthropic,
            &ctx.accounts.anthropic_mint,
            &ctx.accounts.anthropic_vault,
        ),
    ];
    for (amount, from, mint, to) in legs {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            &ctx.accounts.token_program,
            from,
            mint,
            to,
            &ctx.accounts.treasury,
            amount,
            &[],
        )?;
    }

    let p = &mut ctx.accounts.hub_pot;
    p.otc_pending_units = p
        .otc_pending_units
        .checked_add(otc_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.crclx_pending_units = p
        .crclx_pending_units
        .checked_add(crclx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.openai_pending_units = p
        .openai_pending_units
        .checked_add(openai_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.anthropic_pending_units = p
        .anthropic_pending_units
        .checked_add(anthropic_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.otc_deposited_units = p
        .otc_deposited_units
        .checked_add(otc_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.crclx_deposited_units = p
        .crclx_deposited_units
        .checked_add(crclx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.openai_deposited_units = p
        .openai_deposited_units
        .checked_add(openai_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.anthropic_deposited_units = p
        .anthropic_deposited_units
        .checked_add(anthropic_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;

    emit!(HubPotFunded {
        otc_amount,
        crclx_amount,
        openai_amount,
        anthropic_amount,
        otc_pending_after: p.otc_pending_units,
        crclx_pending_after: p.crclx_pending_units,
        openai_pending_after: p.openai_pending_units,
        anthropic_pending_after: p.anthropic_pending_units,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct OpenHubPotRound<'info> {
    /// Permissionless: deterministic snapshot, like `open_reward_round`.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Account<'info, HubPotConfig>,
    #[account(
        init, payer = payer, space = 8 + HubPotRound::INIT_SPACE,
        seeds = [SEED_HUB_POT_ROUND, &hub_pot.round_count.to_le_bytes()], bump
    )]
    pub round: Account<'info, HubPotRound>,
    pub system_program: Program<'info, System>,
}

/// Snapshots all 4 pending bucket balances across the live Σw of active desks into a new
/// `HubPotRound`, then zeroes them. Requires at least one active desk and at least one
/// non-zero bucket.
pub fn open_hub_pot_round(ctx: Context<OpenHubPotRound>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(config.total_weight_bp > 0, HubError::NoActiveStakers);
    let p = &mut ctx.accounts.hub_pot;
    require!(
        p.otc_pending_units > 0
            || p.crclx_pending_units > 0
            || p.openai_pending_units > 0
            || p.anthropic_pending_units > 0,
        HubError::NoHubPotPending
    );

    let (otc_units, crclx_units, openai_units, anthropic_units) = (
        p.otc_pending_units,
        p.crclx_pending_units,
        p.openai_pending_units,
        p.anthropic_pending_units,
    );
    p.otc_pending_units = 0;
    p.crclx_pending_units = 0;
    p.openai_pending_units = 0;
    p.anthropic_pending_units = 0;

    let now = Clock::get()?.unix_timestamp;
    let r = &mut ctx.accounts.round;
    r.index = p.round_count;
    r.otc_units = otc_units;
    r.crclx_units = crclx_units;
    r.openai_units = openai_units;
    r.anthropic_units = anthropic_units;
    r.total_weight_bp = config.total_weight_bp;
    r.otc_distributed_units = 0;
    r.crclx_distributed_units = 0;
    r.openai_distributed_units = 0;
    r.anthropic_distributed_units = 0;
    r.claims = 0;
    r.opened_ts = now;
    r.bump = ctx.bumps.round;

    p.round_count = p
        .round_count
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    emit!(HubPotRoundOpened {
        round: r.index,
        otc_units,
        crclx_units,
        openai_units,
        anthropic_units,
        total_weight_bp: r.total_weight_bp,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(round_index: u32)]
pub struct DistributeHubPotReward<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized, constraint = !config.paused @ HubError::Paused)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: Metaplex Core asset; current owner read directly — push model, matching
    /// `distribute_treasury_reward`'s "pay whoever holds the desk right now" policy.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided && desk_tier.tier > 0 @ HubError::DeskNotActive
    )]
    pub desk_tier: Box<Account<'info, DeskTier>>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Box<Account<'info, HubPotConfig>>,
    #[account(mut, seeds = [SEED_HUB_POT_ROUND, &round_index.to_le_bytes()], bump = round.bump)]
    pub round: Box<Account<'info, HubPotRound>>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Box<Account<'info, TreasuryState>>,
    /// CHECK: program-signed owner of the 4 bucket vaults.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.otc_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.crclx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.crclx_mint @ HubError::InvalidTokenAccount)]
    pub crclx_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.openai_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.openai_mint @ HubError::InvalidTokenAccount)]
    pub openai_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.anthropic_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.anthropic_mint @ HubError::InvalidTokenAccount)]
    pub anthropic_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.openai_vault @ HubError::InvalidTokenAccount)]
    pub openai_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.anthropic_vault @ HubError::InvalidTokenAccount)]
    pub anthropic_vault: UncheckedAccount<'info>,
    /// CHECK: the desk owner's $OTC ATA — mint/owner verified against `desk_asset`'s actual
    /// on-chain owner in the handler, not against a signer.
    #[account(mut)]
    pub owner_otc: UncheckedAccount<'info>,
    /// CHECK: the desk owner's CRCLx ATA — verified as above.
    #[account(mut)]
    pub owner_crclx: UncheckedAccount<'info>,
    /// CHECK: the desk owner's OpenAI-stock ATA — verified as above.
    #[account(mut)]
    pub owner_openai: UncheckedAccount<'info>,
    /// CHECK: the desk owner's Anthropic-stock ATA — verified as above.
    #[account(mut)]
    pub owner_anthropic: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    /// One payout per desk asset per round.
    #[account(
        init, payer = authority, space = 8 + HubPotClaim::INIT_SPACE,
        seeds = [SEED_HUB_POT_CLAIM, &round_index.to_le_bytes(), desk_asset.key().as_ref()], bump
    )]
    pub claim: Box<Account<'info, HubPotClaim>>,
    pub system_program: Program<'info, System>,
}

// NOTE (stack): config/desk_tier/hub_pot/round/treasury_state/claim are Box<Account<...>> here
// (unlike the 1-mint DistributeTreasuryReward this mirrors) because the 4x mint/vault/ATA fan-out
// pushes try_accounts' generated stack frame past the SBF 4096-byte limit — solana-verify's build
// reported "overflows the maximum allowed frame space ... 5312 bytes" without boxing. Boxing moves
// each account's data to the heap; Deref/DerefMut make every existing field access below
// (ctx.accounts.config.foo, &mut ctx.accounts.hub_pot, etc.) work unchanged.

/// Pays an active desk's tier-weighted share of all 4 HUB Pot buckets in one transaction,
/// mirroring `distribute_treasury_reward` exactly but ×4 mints. Each bucket's payout is
/// independently capped so its `<bucket>_distributed_units` can never exceed
/// `round.<bucket>_units` (`HubPotRoundExceeded`); a bucket whose share floors to zero is
/// simply skipped (no partial-claim failure).
pub fn distribute_hub_pot_reward(
    ctx: Context<DistributeHubPotReward>,
    round_index: u32,
) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_token_account(&ctx.accounts.owner_otc, &ctx.accounts.hub_pot.otc_mint, &asset.owner)?;
    require_token_account(
        &ctx.accounts.owner_crclx,
        &ctx.accounts.hub_pot.crclx_mint,
        &asset.owner,
    )?;
    require_token_account(
        &ctx.accounts.owner_openai,
        &ctx.accounts.hub_pot.openai_mint,
        &asset.owner,
    )?;
    require_token_account(
        &ctx.accounts.owner_anthropic,
        &ctx.accounts.hub_pot.anthropic_mint,
        &asset.owner,
    )?;

    let w = ctx.accounts.config.weight_bp(ctx.accounts.desk_tier.tier)?;
    let round = &mut ctx.accounts.round;
    let total_w = round.total_weight_bp;
    let otc_amount = reward_share(round.otc_units, w, total_w)?;
    let crclx_amount = reward_share(round.crclx_units, w, total_w)?;
    let openai_amount = reward_share(round.openai_units, w, total_w)?;
    let anthropic_amount = reward_share(round.anthropic_units, w, total_w)?;
    require!(
        otc_amount > 0 || crclx_amount > 0 || openai_amount > 0 || anthropic_amount > 0,
        HubError::ZeroAmount
    );

    let otc_distributed_after = round
        .otc_distributed_units
        .checked_add(otc_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let crclx_distributed_after = round
        .crclx_distributed_units
        .checked_add(crclx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let openai_distributed_after = round
        .openai_distributed_units
        .checked_add(openai_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let anthropic_distributed_after = round
        .anthropic_distributed_units
        .checked_add(anthropic_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(
        otc_distributed_after <= round.otc_units
            && crclx_distributed_after <= round.crclx_units
            && openai_distributed_after <= round.openai_units
            && anthropic_distributed_after <= round.anthropic_units,
        HubError::HubPotRoundExceeded
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
    let legs: [(u64, &UncheckedAccount, &UncheckedAccount, &UncheckedAccount); 4] = [
        (otc_amount, &ctx.accounts.otc_vault, &ctx.accounts.otc_mint, &ctx.accounts.owner_otc),
        (
            crclx_amount,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.owner_crclx,
        ),
        (
            openai_amount,
            &ctx.accounts.openai_vault,
            &ctx.accounts.openai_mint,
            &ctx.accounts.owner_openai,
        ),
        (
            anthropic_amount,
            &ctx.accounts.anthropic_vault,
            &ctx.accounts.anthropic_mint,
            &ctx.accounts.owner_anthropic,
        ),
    ];
    for (amount, from, mint, to) in legs {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            &ctx.accounts.token_program,
            from,
            mint,
            to,
            &ctx.accounts.vault,
            amount,
            seeds,
        )?;
    }

    round.otc_distributed_units = otc_distributed_after;
    round.crclx_distributed_units = crclx_distributed_after;
    round.openai_distributed_units = openai_distributed_after;
    round.anthropic_distributed_units = anthropic_distributed_after;
    round.claims = round
        .claims
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let claims = round.claims;

    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.claim;
    c.round = round_index;
    c.asset = ctx.accounts.desk_asset.key();
    c.owner = asset.owner;
    c.otc_units = otc_amount;
    c.crclx_units = crclx_amount;
    c.openai_units = openai_amount;
    c.anthropic_units = anthropic_amount;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    emit!(HubPotRewardDistributed {
        round: round_index,
        asset: c.asset,
        owner: c.owner,
        otc_units: otc_amount,
        crclx_units: crclx_amount,
        openai_units: openai_amount,
        anthropic_units: anthropic_amount,
        claims,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(round_index: u32)]
pub struct ClaimHubPotReward<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: Metaplex Core asset; owner verified against `claimant` in the handler.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided && desk_tier.tier > 0 @ HubError::DeskNotActive
    )]
    pub desk_tier: Box<Account<'info, DeskTier>>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Box<Account<'info, HubPotConfig>>,
    #[account(mut, seeds = [SEED_HUB_POT_ROUND, &round_index.to_le_bytes()], bump = round.bump)]
    pub round: Box<Account<'info, HubPotRound>>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Box<Account<'info, TreasuryState>>,
    /// CHECK: program-signed owner of the 4 bucket vaults.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.otc_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.crclx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.crclx_mint @ HubError::InvalidTokenAccount)]
    pub crclx_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.openai_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.openai_mint @ HubError::InvalidTokenAccount)]
    pub openai_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.anthropic_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.anthropic_mint @ HubError::InvalidTokenAccount)]
    pub anthropic_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.openai_vault @ HubError::InvalidTokenAccount)]
    pub openai_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.anthropic_vault @ HubError::InvalidTokenAccount)]
    pub anthropic_vault: UncheckedAccount<'info>,
    /// CHECK: claimant's $OTC ATA (mint/owner verified in handler).
    #[account(mut)]
    pub claimant_otc: UncheckedAccount<'info>,
    /// CHECK: claimant's CRCLx ATA — verified as above.
    #[account(mut)]
    pub claimant_crclx: UncheckedAccount<'info>,
    /// CHECK: claimant's OpenAI-stock ATA — verified as above.
    #[account(mut)]
    pub claimant_openai: UncheckedAccount<'info>,
    /// CHECK: claimant's Anthropic-stock ATA — verified as above.
    #[account(mut)]
    pub claimant_anthropic: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    /// Same seeds as `DistributeHubPotReward::claim` — pull and push share one PDA per
    /// (round, desk asset), so a desk can only ever be paid once regardless of which path is used.
    #[account(
        init, payer = claimant, space = 8 + HubPotClaim::INIT_SPACE,
        seeds = [SEED_HUB_POT_CLAIM, &round_index.to_le_bytes(), desk_asset.key().as_ref()], bump
    )]
    pub claim: Box<Account<'info, HubPotClaim>>,
    pub system_program: Program<'info, System>,
}

// NOTE (stack): boxed for the same reason as DistributeHubPotReward above — see that struct's
// comment.

/// User-initiated pull: a desk's current owner claims its own tier-weighted share of all 4
/// M.I.M ETF (Magic Internet Money — $OTC/CRCLx/OpenAI/Anthropic) buckets for an open round,
/// self-signed, paying the tx fee and the `HubPotClaim` rent themselves. Identical math and
/// per-bucket over-draw guard to `distribute_hub_pot_reward`; the two share the same
/// `HubPotClaim` PDA so a desk can only ever be paid once per round regardless of path (mirrors
/// `claim_airdrop` / `distribute_airdrop`). Bulk claiming across several owned desks is a client
/// concern — one `claim_hub_pot_reward` ix per desk, batched into as few transactions as fit
/// (see `claim_yield`'s multi-desk batching pattern).
pub fn claim_hub_pot_reward(ctx: Context<ClaimHubPotReward>, round_index: u32) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.claimant.key(),
        HubError::NotDeskOwner
    );
    require_token_account(
        &ctx.accounts.claimant_otc,
        &ctx.accounts.hub_pot.otc_mint,
        ctx.accounts.claimant.key,
    )?;
    require_token_account(
        &ctx.accounts.claimant_crclx,
        &ctx.accounts.hub_pot.crclx_mint,
        ctx.accounts.claimant.key,
    )?;
    require_token_account(
        &ctx.accounts.claimant_openai,
        &ctx.accounts.hub_pot.openai_mint,
        ctx.accounts.claimant.key,
    )?;
    require_token_account(
        &ctx.accounts.claimant_anthropic,
        &ctx.accounts.hub_pot.anthropic_mint,
        ctx.accounts.claimant.key,
    )?;

    let w = ctx.accounts.config.weight_bp(ctx.accounts.desk_tier.tier)?;
    let round = &mut ctx.accounts.round;
    let total_w = round.total_weight_bp;
    let otc_amount = reward_share(round.otc_units, w, total_w)?;
    let crclx_amount = reward_share(round.crclx_units, w, total_w)?;
    let openai_amount = reward_share(round.openai_units, w, total_w)?;
    let anthropic_amount = reward_share(round.anthropic_units, w, total_w)?;
    require!(
        otc_amount > 0 || crclx_amount > 0 || openai_amount > 0 || anthropic_amount > 0,
        HubError::ZeroAmount
    );

    let otc_distributed_after = round
        .otc_distributed_units
        .checked_add(otc_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let crclx_distributed_after = round
        .crclx_distributed_units
        .checked_add(crclx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let openai_distributed_after = round
        .openai_distributed_units
        .checked_add(openai_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let anthropic_distributed_after = round
        .anthropic_distributed_units
        .checked_add(anthropic_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(
        otc_distributed_after <= round.otc_units
            && crclx_distributed_after <= round.crclx_units
            && openai_distributed_after <= round.openai_units
            && anthropic_distributed_after <= round.anthropic_units,
        HubError::HubPotRoundExceeded
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
    let legs: [(u64, &UncheckedAccount, &UncheckedAccount, &UncheckedAccount); 4] = [
        (
            otc_amount,
            &ctx.accounts.otc_vault,
            &ctx.accounts.otc_mint,
            &ctx.accounts.claimant_otc,
        ),
        (
            crclx_amount,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.claimant_crclx,
        ),
        (
            openai_amount,
            &ctx.accounts.openai_vault,
            &ctx.accounts.openai_mint,
            &ctx.accounts.claimant_openai,
        ),
        (
            anthropic_amount,
            &ctx.accounts.anthropic_vault,
            &ctx.accounts.anthropic_mint,
            &ctx.accounts.claimant_anthropic,
        ),
    ];
    for (amount, from, mint, to) in legs {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            &ctx.accounts.token_program,
            from,
            mint,
            to,
            &ctx.accounts.vault,
            amount,
            seeds,
        )?;
    }

    round.otc_distributed_units = otc_distributed_after;
    round.crclx_distributed_units = crclx_distributed_after;
    round.openai_distributed_units = openai_distributed_after;
    round.anthropic_distributed_units = anthropic_distributed_after;
    round.claims = round
        .claims
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let claims = round.claims;

    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.claim;
    c.round = round_index;
    c.asset = ctx.accounts.desk_asset.key();
    c.owner = asset.owner;
    c.otc_units = otc_amount;
    c.crclx_units = crclx_amount;
    c.openai_units = openai_amount;
    c.anthropic_units = anthropic_amount;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    emit!(HubPotRewardClaimed {
        round: round_index,
        asset: c.asset,
        claimant: c.owner,
        otc_units: otc_amount,
        crclx_units: crclx_amount,
        openai_units: openai_amount,
        anthropic_units: anthropic_amount,
        claims,
    });
    Ok(())
}
