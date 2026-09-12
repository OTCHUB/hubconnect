//! §A5.1 — HUB Pot: the MemeStock basket ($OTC, CRCLx, NVDAx, SPCXx) reward, funded by the
//! treasury's converted source-B (13-stock treasury-desk) yield. Mirrors `tokenomics.rs`'s
//! `fund_treasury_reward` / `open_reward_round` / `distribute_treasury_reward` trio exactly,
//! generalized from 1 mint to 4 — independent bookkeeping, independent vaults, independent
//! funding source. See docs/hubconnect-spec.md §A5.1.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::require_desk;
use crate::instructions::otc_pay::{require_token_account, token_account_amount, transfer_checked};
use crate::instructions::pot::{add, bps_of, sub};
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
    /// CHECK: spl-token account, mint = nvdax_mint, owner = vault (verified in handler).
    pub nvdax_vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = spcxx_mint, owner = vault (verified in handler).
    pub spcxx_vault: UncheckedAccount<'info>,
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
    nvdax_mint: Pubkey,
    spcxx_mint: Pubkey,
) -> Result<()> {
    require_token_account(&ctx.accounts.otc_vault, &otc_mint, ctx.accounts.vault.key)?;
    require_token_account(
        &ctx.accounts.crclx_vault,
        &crclx_mint,
        ctx.accounts.vault.key,
    )?;
    require_token_account(
        &ctx.accounts.nvdax_vault,
        &nvdax_mint,
        ctx.accounts.vault.key,
    )?;
    require_token_account(
        &ctx.accounts.spcxx_vault,
        &spcxx_mint,
        ctx.accounts.vault.key,
    )?;
    let p = &mut ctx.accounts.hub_pot;
    p.otc_mint = otc_mint;
    p.crclx_mint = crclx_mint;
    p.nvdax_mint = nvdax_mint;
    p.spcxx_mint = spcxx_mint;
    p.otc_vault = ctx.accounts.otc_vault.key();
    p.crclx_vault = ctx.accounts.crclx_vault.key();
    p.nvdax_vault = ctx.accounts.nvdax_vault.key();
    p.spcxx_vault = ctx.accounts.spcxx_vault.key();
    p.bump = ctx.bumps.hub_pot;
    Ok(())
}

#[derive(Accounts)]
pub struct InitHubPotInflow<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = authority, space = 8 + HubPotInflowState::INIT_SPACE,
        seeds = [SEED_HUB_POT_INFLOW], bump
    )]
    pub inflow: Account<'info, HubPotInflowState>,
    pub system_program: Program<'info, System>,
}

/// One-time, post-`init_hub_pot` bookkeeping needed by `recognize_hub_pot_inflow` — see
/// `SEED_HUB_POT_INFLOW`'s doc comment for why this is a standalone PDA rather than new fields
/// appended to the already-live `HubPotConfig`. All 4 counters start at zero; they only ever grow,
/// bumped by `distribute_hub_pot_reward`/`claim_hub_pot_reward`.
pub fn init_hub_pot_inflow(ctx: Context<InitHubPotInflow>) -> Result<()> {
    let p = &mut ctx.accounts.inflow;
    p.otc_claimed_units = 0;
    p.crclx_claimed_units = 0;
    p.nvdax_claimed_units = 0;
    p.spcxx_claimed_units = 0;
    p.bump = ctx.bumps.inflow;
    Ok(())
}

/// Bucket selector for `update_hub_pot_mint` — lets governance rotate a basket asset (e.g. a
/// synthetic pre-IPO token judged too exposed to post-listing deviation risk, as with the
/// original OpenAI/Anthropic pre-IPO legs before genesis swapped them for the live, directly
/// custodied NVDAx/SPCXx xStock RWAs) for a different mint without a program upgrade/migration.
/// Mirrors `CreatorFeeLeg`'s enum-selects-a-field pattern; field *names* on `HubPotConfig`
/// (otc/crclx/nvdax/spcxx) are fixed identifiers from genesis and don't necessarily track which
/// real-world asset currently backs a bucket — e.g. the "nvdax" bucket may later be kept as a
/// label while its mint points at a different asset entirely.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HubPotBucket {
    Otc,
    Crclx,
    Nvdax,
    Spcxx,
}

#[derive(Accounts)]
pub struct UpdateHubPotMint<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; owns `old_vault`, must own `new_vault` (verified in
    /// the handler), and signs the dust-sweep transfer below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Account<'info, HubPotConfig>,
    /// CHECK: the selected bucket's *current* mint (matched against `hub_pot` in the handler);
    /// read only for `TransferChecked` decimals on the dust sweep below.
    pub old_mint: UncheckedAccount<'info>,
    /// CHECK: the selected bucket's current vault (matched against `hub_pot` in the handler);
    /// any residual balance is swept to `sweep_dest` before the swap is recorded, so nothing is
    /// stranded once `hub_pot` stops pointing at it.
    #[account(mut)]
    pub old_vault: UncheckedAccount<'info>,
    /// CHECK: `Config.ops_wallet`'s ATA for `old_mint` (verified in handler) — destination for
    /// any leftover `old_vault` balance; only touched when that balance is non-zero.
    #[account(mut)]
    pub sweep_dest: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = `new_mint`, owner = `vault` PDA (verified in handler) —
    /// created off-chain ahead of time, same pattern as `init_hub_pot`'s bucket vaults.
    pub new_vault: UncheckedAccount<'info>,
    /// CHECK: `old_mint`'s token program — classic Token or Token-2022, dispatched to whichever
    /// one `old_mint` is actually owned by — asserted in `transfer_checked`. Only ever touches
    /// one bucket's mint per call, so a single dynamically-validated account suffices here
    /// (unlike `FundHubPot`/`DistributeHubPotReward`/`ClaimHubPotReward`, which move all 4
    /// buckets in one instruction and so need one `token_program` account per bucket).
    pub token_program: UncheckedAccount<'info>,
}

/// Swaps one HUB Pot bucket's backing mint + vault. Requires the bucket's pending balance to be
/// zero first (settle it via `open_hub_pot_round` + distribute/claim, or a `fund_hub_pot` call
/// that simply never earmarks it) so no in-flight reward math is silently reassigned to a
/// different asset mid-round. Any dust still sitting in the old vault (e.g. rounding remainder
/// below a claim's floor) is swept to `ops_wallet` rather than blocking the swap.
pub fn update_hub_pot_mint(
    ctx: Context<UpdateHubPotMint>,
    bucket: HubPotBucket,
    new_mint: Pubkey,
) -> Result<()> {
    let (current_mint, current_vault, pending) = {
        let p = &ctx.accounts.hub_pot;
        match bucket {
            HubPotBucket::Otc => (p.otc_mint, p.otc_vault, p.otc_pending_units),
            HubPotBucket::Crclx => (p.crclx_mint, p.crclx_vault, p.crclx_pending_units),
            HubPotBucket::Nvdax => (p.nvdax_mint, p.nvdax_vault, p.nvdax_pending_units),
            HubPotBucket::Spcxx => (p.spcxx_mint, p.spcxx_vault, p.spcxx_pending_units),
        }
    };
    require!(pending == 0, HubError::HubPotBucketNotDrained);
    require!(new_mint != current_mint, HubError::InvariantViolated);
    require_keys_eq!(
        ctx.accounts.old_vault.key(),
        current_vault,
        HubError::InvalidTokenAccount
    );
    require_keys_eq!(
        ctx.accounts.old_mint.key(),
        current_mint,
        HubError::InvalidTokenAccount
    );
    require_token_account(
        &ctx.accounts.old_vault,
        &current_mint,
        &ctx.accounts.vault.key(),
    )?;
    require_token_account(
        &ctx.accounts.sweep_dest,
        &current_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.new_vault,
        &new_mint,
        &ctx.accounts.vault.key(),
    )?;

    let leftover = token_account_amount(&ctx.accounts.old_vault)?;
    if leftover > 0 {
        let vault_bump = ctx.accounts.treasury_state.vault_bump;
        let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.old_vault,
            &ctx.accounts.old_mint,
            &ctx.accounts.sweep_dest,
            &ctx.accounts.vault,
            leftover,
            seeds,
        )?;
    }

    let new_vault_key = ctx.accounts.new_vault.key();
    let p = &mut ctx.accounts.hub_pot;
    match bucket {
        HubPotBucket::Otc => {
            p.otc_mint = new_mint;
            p.otc_vault = new_vault_key;
        }
        HubPotBucket::Crclx => {
            p.crclx_mint = new_mint;
            p.crclx_vault = new_vault_key;
        }
        HubPotBucket::Nvdax => {
            p.nvdax_mint = new_mint;
            p.nvdax_vault = new_vault_key;
        }
        HubPotBucket::Spcxx => {
            p.spcxx_mint = new_mint;
            p.spcxx_vault = new_vault_key;
        }
    }

    emit!(HubPotMintUpdated {
        bucket: bucket as u8,
        old_mint: current_mint,
        new_mint,
        old_vault: current_vault,
        new_vault: new_vault_key,
        swept_to_ops: leftover,
    });
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
    /// CHECK: matched against hub_pot.nvdax_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.nvdax_mint @ HubError::InvalidTokenAccount)]
    pub nvdax_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.spcxx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.spcxx_mint @ HubError::InvalidTokenAccount)]
    pub spcxx_mint: UncheckedAccount<'info>,
    /// CHECK: treasury's $OTC source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_otc: UncheckedAccount<'info>,
    /// CHECK: treasury's CRCLx source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_crclx: UncheckedAccount<'info>,
    /// CHECK: treasury's NVDAx source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_nvdax: UncheckedAccount<'info>,
    /// CHECK: treasury's SPCXx source ATA (mint/owner verified in handler).
    #[account(mut)]
    pub treasury_spcxx: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.nvdax_vault @ HubError::InvalidTokenAccount)]
    pub nvdax_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.spcxx_vault @ HubError::InvalidTokenAccount)]
    pub spcxx_vault: UncheckedAccount<'info>,
    /// CHECK: `Config.protocol_fee_bp`'s skim destination for the $OTC leg — ops_wallet's own
    /// ATA (mint/owner verified in handler), same 10% carve-out as `register_treasury_inflow`.
    #[account(mut)]
    pub ops_otc: UncheckedAccount<'info>,
    /// CHECK: skim destination for the CRCLx leg — verified as above.
    #[account(mut)]
    pub ops_crclx: UncheckedAccount<'info>,
    /// CHECK: skim destination for the NVDAx leg — verified as above.
    #[account(mut)]
    pub ops_nvdax: UncheckedAccount<'info>,
    /// CHECK: skim destination for the SPCXx leg — verified as above.
    #[account(mut)]
    pub ops_spcxx: UncheckedAccount<'info>,
    /// CHECK: $OTC's token program (Token-2022 today; whichever program `hub_pot.otc_mint` is
    /// actually owned by after a future `update_hub_pot_mint`), asserted in `transfer_checked`.
    /// This instruction moves all 4 buckets in one call, and `update_hub_pot_mint` can move any
    /// single bucket to a mint on a different token program without touching the other three, so
    /// each bucket gets its own `token_program` account rather than one shared account.
    pub otc_token_program: UncheckedAccount<'info>,
    /// CHECK: CRCLx's token program — asserted the same way against `hub_pot.crclx_mint`.
    pub crclx_token_program: UncheckedAccount<'info>,
    /// CHECK: NVDAx's token program — asserted the same way against `hub_pot.nvdax_mint`.
    pub nvdax_token_program: UncheckedAccount<'info>,
    /// CHECK: SPCXx's token program — asserted the same way against `hub_pot.spcxx_mint`.
    pub spcxx_token_program: UncheckedAccount<'info>,
}

/// Treasury deposits the four already-converted basket amounts (swapped off-chain by the
/// keeper from source-B's 13-stock claim, per §A5.1) in one instruction. `Config.protocol_fee_bp`
/// (§A5 revenue-model extension) is skimmed per-mint into `ops_wallet`'s matching ATA first —
/// only the remainder is transferred into the bucket vault and credited as pending/deposited.
/// Each leg (skim + deposit) is an enforced `TransferChecked`, not merely attested (mirrors
/// `fund_treasury_reward`); a zero-amount leg is skipped rather than rejected, since not every
/// fund cycle need touch every bucket evenly.
pub fn fund_hub_pot(
    ctx: Context<FundHubPot>,
    otc_amount: u64,
    crclx_amount: u64,
    nvdax_amount: u64,
    spcxx_amount: u64,
) -> Result<()> {
    require!(
        otc_amount > 0 || crclx_amount > 0 || nvdax_amount > 0 || spcxx_amount > 0,
        HubError::ZeroAmount
    );
    let fee_bp = ctx.accounts.config.protocol_fee_bp;
    require_token_account(
        &ctx.accounts.ops_otc,
        &ctx.accounts.hub_pot.otc_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_crclx,
        &ctx.accounts.hub_pot.crclx_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_nvdax,
        &ctx.accounts.hub_pot.nvdax_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_spcxx,
        &ctx.accounts.hub_pot.spcxx_mint,
        &ctx.accounts.config.ops_wallet,
    )?;

    let legs: [(
        u64,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
    ); 4] = [
        (
            otc_amount,
            &ctx.accounts.treasury_otc,
            &ctx.accounts.otc_mint,
            &ctx.accounts.otc_vault,
            &ctx.accounts.ops_otc,
            &ctx.accounts.otc_token_program,
        ),
        (
            crclx_amount,
            &ctx.accounts.treasury_crclx,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.ops_crclx,
            &ctx.accounts.crclx_token_program,
        ),
        (
            nvdax_amount,
            &ctx.accounts.treasury_nvdax,
            &ctx.accounts.nvdax_mint,
            &ctx.accounts.nvdax_vault,
            &ctx.accounts.ops_nvdax,
            &ctx.accounts.nvdax_token_program,
        ),
        (
            spcxx_amount,
            &ctx.accounts.treasury_spcxx,
            &ctx.accounts.spcxx_mint,
            &ctx.accounts.spcxx_vault,
            &ctx.accounts.ops_spcxx,
            &ctx.accounts.spcxx_token_program,
        ),
    ];
    let mut net = [0u64; 4];
    let mut to_ops_amounts = [0u64; 4];
    for (i, (amount, from, mint, to, ops_to, token_program)) in legs.into_iter().enumerate() {
        if amount == 0 {
            continue;
        }
        let to_ops = bps_of(amount, fee_bp)?;
        let to_pool = sub(amount, to_ops)?;
        if to_ops > 0 {
            transfer_checked(
                token_program,
                from,
                mint,
                ops_to,
                &ctx.accounts.treasury,
                to_ops,
                &[],
            )?;
        }
        if to_pool > 0 {
            transfer_checked(
                token_program,
                from,
                mint,
                to,
                &ctx.accounts.treasury,
                to_pool,
                &[],
            )?;
        }
        net[i] = to_pool;
        to_ops_amounts[i] = to_ops;
    }
    let (otc_net, crclx_net, nvdax_net, spcxx_net) = (net[0], net[1], net[2], net[3]);

    let p = &mut ctx.accounts.hub_pot;
    p.otc_pending_units = p
        .otc_pending_units
        .checked_add(otc_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.crclx_pending_units = p
        .crclx_pending_units
        .checked_add(crclx_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.nvdax_pending_units = p
        .nvdax_pending_units
        .checked_add(nvdax_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.spcxx_pending_units = p
        .spcxx_pending_units
        .checked_add(spcxx_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.otc_deposited_units = p
        .otc_deposited_units
        .checked_add(otc_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.crclx_deposited_units = p
        .crclx_deposited_units
        .checked_add(crclx_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.nvdax_deposited_units = p
        .nvdax_deposited_units
        .checked_add(nvdax_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    p.spcxx_deposited_units = p
        .spcxx_deposited_units
        .checked_add(spcxx_net)
        .ok_or_else(|| error!(HubError::MathOverflow))?;

    emit!(HubPotFunded {
        otc_amount: otc_net,
        crclx_amount: crclx_net,
        nvdax_amount: nvdax_net,
        spcxx_amount: spcxx_net,
        otc_pending_after: p.otc_pending_units,
        crclx_pending_after: p.crclx_pending_units,
        nvdax_pending_after: p.nvdax_pending_units,
        spcxx_pending_after: p.spcxx_pending_units,
    });
    emit!(HubPotProtocolFeeSkimmed {
        otc_to_ops: to_ops_amounts[0],
        crclx_to_ops: to_ops_amounts[1],
        nvdax_to_ops: to_ops_amounts[2],
        spcxx_to_ops: to_ops_amounts[3],
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
            || p.nvdax_pending_units > 0
            || p.spcxx_pending_units > 0,
        HubError::NoHubPotPending
    );

    let (otc_units, crclx_units, nvdax_units, spcxx_units) = (
        p.otc_pending_units,
        p.crclx_pending_units,
        p.nvdax_pending_units,
        p.spcxx_pending_units,
    );
    p.otc_pending_units = 0;
    p.crclx_pending_units = 0;
    p.nvdax_pending_units = 0;
    p.spcxx_pending_units = 0;

    let now = Clock::get()?.unix_timestamp;
    let r = &mut ctx.accounts.round;
    r.index = p.round_count;
    r.otc_units = otc_units;
    r.crclx_units = crclx_units;
    r.nvdax_units = nvdax_units;
    r.spcxx_units = spcxx_units;
    r.total_weight_bp = config.total_weight_bp;
    r.otc_distributed_units = 0;
    r.crclx_distributed_units = 0;
    r.nvdax_distributed_units = 0;
    r.spcxx_distributed_units = 0;
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
        nvdax_units,
        spcxx_units,
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
    /// Lifetime "ever paid to desks" counters — bumped here so `recognize_hub_pot_inflow` can
    /// tell genuinely new vault inflow apart from balance still earmarked for an open round.
    #[account(mut, seeds = [SEED_HUB_POT_INFLOW], bump = inflow.bump)]
    pub inflow: Box<Account<'info, HubPotInflowState>>,
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
    /// CHECK: matched against hub_pot.nvdax_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.nvdax_mint @ HubError::InvalidTokenAccount)]
    pub nvdax_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.spcxx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.spcxx_mint @ HubError::InvalidTokenAccount)]
    pub spcxx_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.nvdax_vault @ HubError::InvalidTokenAccount)]
    pub nvdax_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.spcxx_vault @ HubError::InvalidTokenAccount)]
    pub spcxx_vault: UncheckedAccount<'info>,
    /// CHECK: the desk owner's $OTC ATA — mint/owner verified against `desk_asset`'s actual
    /// on-chain owner in the handler, not against a signer.
    #[account(mut)]
    pub owner_otc: UncheckedAccount<'info>,
    /// CHECK: the desk owner's CRCLx ATA — verified as above.
    #[account(mut)]
    pub owner_crclx: UncheckedAccount<'info>,
    /// CHECK: the desk owner's NVDAx ATA — verified as above.
    #[account(mut)]
    pub owner_nvdax: UncheckedAccount<'info>,
    /// CHECK: the desk owner's SPCXx ATA — verified as above.
    #[account(mut)]
    pub owner_spcxx: UncheckedAccount<'info>,
    /// CHECK: $OTC's token program — asserted in `transfer_checked` against `hub_pot.otc_mint`'s
    /// actual owner. One `token_program` account per bucket (see `FundHubPot`'s doc comment for
    /// why a single shared account isn't safe once `update_hub_pot_mint` can move a bucket to a
    /// mint on a different token program).
    pub otc_token_program: UncheckedAccount<'info>,
    /// CHECK: CRCLx's token program — asserted the same way against `hub_pot.crclx_mint`.
    pub crclx_token_program: UncheckedAccount<'info>,
    /// CHECK: NVDAx's token program — asserted the same way against `hub_pot.nvdax_mint`.
    pub nvdax_token_program: UncheckedAccount<'info>,
    /// CHECK: SPCXx's token program — asserted the same way against `hub_pot.spcxx_mint`.
    pub spcxx_token_program: UncheckedAccount<'info>,
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
    require_token_account(
        &ctx.accounts.owner_otc,
        &ctx.accounts.hub_pot.otc_mint,
        &asset.owner,
    )?;
    require_token_account(
        &ctx.accounts.owner_crclx,
        &ctx.accounts.hub_pot.crclx_mint,
        &asset.owner,
    )?;
    require_token_account(
        &ctx.accounts.owner_nvdax,
        &ctx.accounts.hub_pot.nvdax_mint,
        &asset.owner,
    )?;
    require_token_account(
        &ctx.accounts.owner_spcxx,
        &ctx.accounts.hub_pot.spcxx_mint,
        &asset.owner,
    )?;

    let w = ctx.accounts.config.weight_bp(ctx.accounts.desk_tier.tier)?;
    let round = &mut ctx.accounts.round;
    let total_w = round.total_weight_bp;
    let otc_amount = reward_share(round.otc_units, w, total_w)?;
    let crclx_amount = reward_share(round.crclx_units, w, total_w)?;
    let nvdax_amount = reward_share(round.nvdax_units, w, total_w)?;
    let spcxx_amount = reward_share(round.spcxx_units, w, total_w)?;
    require!(
        otc_amount > 0 || crclx_amount > 0 || nvdax_amount > 0 || spcxx_amount > 0,
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
    let nvdax_distributed_after = round
        .nvdax_distributed_units
        .checked_add(nvdax_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let spcxx_distributed_after = round
        .spcxx_distributed_units
        .checked_add(spcxx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(
        otc_distributed_after <= round.otc_units
            && crclx_distributed_after <= round.crclx_units
            && nvdax_distributed_after <= round.nvdax_units
            && spcxx_distributed_after <= round.spcxx_units,
        HubError::HubPotRoundExceeded
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
    let legs: [(
        u64,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
    ); 4] = [
        (
            otc_amount,
            &ctx.accounts.otc_vault,
            &ctx.accounts.otc_mint,
            &ctx.accounts.owner_otc,
            &ctx.accounts.otc_token_program,
        ),
        (
            crclx_amount,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.owner_crclx,
            &ctx.accounts.crclx_token_program,
        ),
        (
            nvdax_amount,
            &ctx.accounts.nvdax_vault,
            &ctx.accounts.nvdax_mint,
            &ctx.accounts.owner_nvdax,
            &ctx.accounts.nvdax_token_program,
        ),
        (
            spcxx_amount,
            &ctx.accounts.spcxx_vault,
            &ctx.accounts.spcxx_mint,
            &ctx.accounts.owner_spcxx,
            &ctx.accounts.spcxx_token_program,
        ),
    ];
    for (amount, from, mint, to, token_program) in legs {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            token_program,
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
    round.nvdax_distributed_units = nvdax_distributed_after;
    round.spcxx_distributed_units = spcxx_distributed_after;
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
    c.nvdax_units = nvdax_amount;
    c.spcxx_units = spcxx_amount;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    let inflow = &mut ctx.accounts.inflow;
    inflow.otc_claimed_units = add(inflow.otc_claimed_units, otc_amount)?;
    inflow.crclx_claimed_units = add(inflow.crclx_claimed_units, crclx_amount)?;
    inflow.nvdax_claimed_units = add(inflow.nvdax_claimed_units, nvdax_amount)?;
    inflow.spcxx_claimed_units = add(inflow.spcxx_claimed_units, spcxx_amount)?;

    emit!(HubPotRewardDistributed {
        round: round_index,
        asset: c.asset,
        owner: c.owner,
        otc_units: otc_amount,
        crclx_units: crclx_amount,
        nvdax_units: nvdax_amount,
        spcxx_units: spcxx_amount,
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
    /// Lifetime "ever paid to desks" counters — bumped here so `recognize_hub_pot_inflow` can
    /// tell genuinely new vault inflow apart from balance still earmarked for an open round.
    #[account(mut, seeds = [SEED_HUB_POT_INFLOW], bump = inflow.bump)]
    pub inflow: Box<Account<'info, HubPotInflowState>>,
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
    /// CHECK: matched against hub_pot.nvdax_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.nvdax_mint @ HubError::InvalidTokenAccount)]
    pub nvdax_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.spcxx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.spcxx_mint @ HubError::InvalidTokenAccount)]
    pub spcxx_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.nvdax_vault @ HubError::InvalidTokenAccount)]
    pub nvdax_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.spcxx_vault @ HubError::InvalidTokenAccount)]
    pub spcxx_vault: UncheckedAccount<'info>,
    /// CHECK: claimant's $OTC ATA (mint/owner verified in handler).
    #[account(mut)]
    pub claimant_otc: UncheckedAccount<'info>,
    /// CHECK: claimant's CRCLx ATA — verified as above.
    #[account(mut)]
    pub claimant_crclx: UncheckedAccount<'info>,
    /// CHECK: claimant's NVDAx ATA — verified as above.
    #[account(mut)]
    pub claimant_nvdax: UncheckedAccount<'info>,
    /// CHECK: claimant's SPCXx ATA — verified as above.
    #[account(mut)]
    pub claimant_spcxx: UncheckedAccount<'info>,
    /// CHECK: $OTC's token program — asserted in `transfer_checked` against `hub_pot.otc_mint`'s
    /// actual owner. One `token_program` account per bucket (see `FundHubPot`'s doc comment for
    /// why a single shared account isn't safe once `update_hub_pot_mint` can move a bucket to a
    /// mint on a different token program).
    pub otc_token_program: UncheckedAccount<'info>,
    /// CHECK: CRCLx's token program — asserted the same way against `hub_pot.crclx_mint`.
    pub crclx_token_program: UncheckedAccount<'info>,
    /// CHECK: NVDAx's token program — asserted the same way against `hub_pot.nvdax_mint`.
    pub nvdax_token_program: UncheckedAccount<'info>,
    /// CHECK: SPCXx's token program — asserted the same way against `hub_pot.spcxx_mint`.
    pub spcxx_token_program: UncheckedAccount<'info>,
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
/// M.I.M ETF (Magic Internet Money — $OTC/CRCLx/NVDAx/SPCXx) buckets for an open round,
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
        &ctx.accounts.claimant_nvdax,
        &ctx.accounts.hub_pot.nvdax_mint,
        ctx.accounts.claimant.key,
    )?;
    require_token_account(
        &ctx.accounts.claimant_spcxx,
        &ctx.accounts.hub_pot.spcxx_mint,
        ctx.accounts.claimant.key,
    )?;

    let w = ctx.accounts.config.weight_bp(ctx.accounts.desk_tier.tier)?;
    let round = &mut ctx.accounts.round;
    let total_w = round.total_weight_bp;
    let otc_amount = reward_share(round.otc_units, w, total_w)?;
    let crclx_amount = reward_share(round.crclx_units, w, total_w)?;
    let nvdax_amount = reward_share(round.nvdax_units, w, total_w)?;
    let spcxx_amount = reward_share(round.spcxx_units, w, total_w)?;
    require!(
        otc_amount > 0 || crclx_amount > 0 || nvdax_amount > 0 || spcxx_amount > 0,
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
    let nvdax_distributed_after = round
        .nvdax_distributed_units
        .checked_add(nvdax_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let spcxx_distributed_after = round
        .spcxx_distributed_units
        .checked_add(spcxx_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(
        otc_distributed_after <= round.otc_units
            && crclx_distributed_after <= round.crclx_units
            && nvdax_distributed_after <= round.nvdax_units
            && spcxx_distributed_after <= round.spcxx_units,
        HubError::HubPotRoundExceeded
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
    let legs: [(
        u64,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
    ); 4] = [
        (
            otc_amount,
            &ctx.accounts.otc_vault,
            &ctx.accounts.otc_mint,
            &ctx.accounts.claimant_otc,
            &ctx.accounts.otc_token_program,
        ),
        (
            crclx_amount,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.claimant_crclx,
            &ctx.accounts.crclx_token_program,
        ),
        (
            nvdax_amount,
            &ctx.accounts.nvdax_vault,
            &ctx.accounts.nvdax_mint,
            &ctx.accounts.claimant_nvdax,
            &ctx.accounts.nvdax_token_program,
        ),
        (
            spcxx_amount,
            &ctx.accounts.spcxx_vault,
            &ctx.accounts.spcxx_mint,
            &ctx.accounts.claimant_spcxx,
            &ctx.accounts.spcxx_token_program,
        ),
    ];
    for (amount, from, mint, to, token_program) in legs {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            token_program,
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
    round.nvdax_distributed_units = nvdax_distributed_after;
    round.spcxx_distributed_units = spcxx_distributed_after;
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
    c.nvdax_units = nvdax_amount;
    c.spcxx_units = spcxx_amount;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    let inflow = &mut ctx.accounts.inflow;
    inflow.otc_claimed_units = add(inflow.otc_claimed_units, otc_amount)?;
    inflow.crclx_claimed_units = add(inflow.crclx_claimed_units, crclx_amount)?;
    inflow.nvdax_claimed_units = add(inflow.nvdax_claimed_units, nvdax_amount)?;
    inflow.spcxx_claimed_units = add(inflow.spcxx_claimed_units, spcxx_amount)?;

    emit!(HubPotRewardClaimed {
        round: round_index,
        asset: c.asset,
        claimant: c.owner,
        otc_units: otc_amount,
        crclx_units: crclx_amount,
        nvdax_units: nvdax_amount,
        spcxx_units: spcxx_amount,
        claims,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecognizeHubPotInflow<'info> {
    /// Permissionless: anyone may trigger reconciliation, same as `open_hub_pot_round` — the
    /// skim rate (`Config.protocol_fee_bp`) and destination (`Config.ops_wallet`) are both fixed
    /// by on-chain config, so there is nothing for a caller to gain beyond paying their own tx
    /// fee. In practice run by a keeper on a schedule (§A5.1), but requires no special key.
    pub payer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_HUB_POT], bump = hub_pot.bump)]
    pub hub_pot: Box<Account<'info, HubPotConfig>>,
    /// Lifetime "ever paid to desks" counters — see `SEED_HUB_POT_INFLOW`'s doc comment for how
    /// this combines with `HubPotConfig.<bucket>_deposited_units` to isolate genuinely new,
    /// unrecognized vault inflow from balance already earmarked by a prior `fund_hub_pot`/
    /// `recognize_hub_pot_inflow` call.
    #[account(seeds = [SEED_HUB_POT_INFLOW], bump = inflow.bump)]
    pub inflow: Box<Account<'info, HubPotInflowState>>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Box<Account<'info, TreasuryState>>,
    /// CHECK: program-signed owner of the 4 bucket vaults; signs the ops-skim transfer below.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.otc_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.otc_mint @ HubError::InvalidTokenAccount)]
    pub otc_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.crclx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.crclx_mint @ HubError::InvalidTokenAccount)]
    pub crclx_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.nvdax_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.nvdax_mint @ HubError::InvalidTokenAccount)]
    pub nvdax_mint: UncheckedAccount<'info>,
    /// CHECK: matched against hub_pot.spcxx_mint; decimals read for TransferChecked.
    #[account(address = hub_pot.spcxx_mint @ HubError::InvalidTokenAccount)]
    pub spcxx_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init; live balance read here, not merely attested.
    #[account(mut, address = hub_pot.otc_vault @ HubError::InvalidTokenAccount)]
    pub otc_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.crclx_vault @ HubError::InvalidTokenAccount)]
    pub crclx_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.nvdax_vault @ HubError::InvalidTokenAccount)]
    pub nvdax_vault: UncheckedAccount<'info>,
    /// CHECK: recorded on HubPotConfig at init.
    #[account(mut, address = hub_pot.spcxx_vault @ HubError::InvalidTokenAccount)]
    pub spcxx_vault: UncheckedAccount<'info>,
    /// CHECK: `Config.protocol_fee_bp`'s skim destination for the $OTC leg — ops_wallet's own
    /// ATA (mint/owner verified in handler), same 10% carve-out as `fund_hub_pot`'s `ops_otc`.
    #[account(mut)]
    pub ops_otc: UncheckedAccount<'info>,
    /// CHECK: skim destination for the CRCLx leg — verified as above.
    #[account(mut)]
    pub ops_crclx: UncheckedAccount<'info>,
    /// CHECK: skim destination for the NVDAx leg — verified as above.
    #[account(mut)]
    pub ops_nvdax: UncheckedAccount<'info>,
    /// CHECK: skim destination for the SPCXx leg — verified as above.
    #[account(mut)]
    pub ops_spcxx: UncheckedAccount<'info>,
    /// CHECK: $OTC's token program, asserted in `transfer_checked` against `hub_pot.otc_mint`'s
    /// actual owner. One `token_program` account per bucket — same rationale as `FundHubPot`.
    pub otc_token_program: UncheckedAccount<'info>,
    /// CHECK: CRCLx's token program — asserted the same way against `hub_pot.crclx_mint`.
    pub crclx_token_program: UncheckedAccount<'info>,
    /// CHECK: NVDAx's token program — asserted the same way against `hub_pot.nvdax_mint`.
    pub nvdax_token_program: UncheckedAccount<'info>,
    /// CHECK: SPCXx's token program — asserted the same way against `hub_pot.spcxx_mint`.
    pub spcxx_token_program: UncheckedAccount<'info>,
}

// NOTE (stack): boxed for the same reason as FundHubPot/DistributeHubPotReward above — the 4x
// mint/vault/ops/token_program fan-out pushes try_accounts' generated stack frame past the SBF
// 4096-byte limit without boxing.

/// §A5.1 reconciliation for the OTC Desks launcher's automatic pro-rata holder payout, which
/// deposits $OTC/CRCLx/NVDAx/SPCXx straight into `HubPotConfig`'s bucket vaults (the
/// `TreasuryState.vault` PDA is itself a $HUB holder, per genesis tokenomics) — completely
/// bypassing `fund_hub_pot`, so those deposits would otherwise sit in the vault forever with no
/// `pending_units` credited and no ops haircut ever skimmed.
///
/// For each bucket: `expected = deposited_units − inflow.claimed_units` is what should still be
/// physically in the vault from every previously-recognized inflow (whether via `fund_hub_pot` or
/// a prior `recognize_hub_pot_inflow` call) net of everything ever paid out to desks. Any live
/// vault balance above that figure can only be new, unrecognized inflow. That gross new amount is
/// skimmed at `Config.protocol_fee_bp` into `ops_wallet` (vault-PDA-signed — the tokens are
/// already resident, so unlike `fund_hub_pot` there is no external transfer-in leg, only the skim
/// transfer-out) and the net remainder is credited to `pending_units`/`deposited_units` exactly
/// as `fund_hub_pot` would. A bucket with zero new inflow is simply skipped; at least one bucket
/// must have new inflow or the call is rejected (`NoHubPotInflow`) rather than emitting a no-op.
pub fn recognize_hub_pot_inflow(ctx: Context<RecognizeHubPotInflow>) -> Result<()> {
    let fee_bp = ctx.accounts.config.protocol_fee_bp;
    require_token_account(
        &ctx.accounts.ops_otc,
        &ctx.accounts.hub_pot.otc_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_crclx,
        &ctx.accounts.hub_pot.crclx_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_nvdax,
        &ctx.accounts.hub_pot.nvdax_mint,
        &ctx.accounts.config.ops_wallet,
    )?;
    require_token_account(
        &ctx.accounts.ops_spcxx,
        &ctx.accounts.hub_pot.spcxx_mint,
        &ctx.accounts.config.ops_wallet,
    )?;

    let otc_balance = token_account_amount(&ctx.accounts.otc_vault)?;
    let crclx_balance = token_account_amount(&ctx.accounts.crclx_vault)?;
    let nvdax_balance = token_account_amount(&ctx.accounts.nvdax_vault)?;
    let spcxx_balance = token_account_amount(&ctx.accounts.spcxx_vault)?;

    let hub_pot = &ctx.accounts.hub_pot;
    let inflow_state = &ctx.accounts.inflow;
    // `sub` errors on underflow (MathOverflow) — a live balance below what recognized history
    // implies would mean the vault was drained outside this program, an invariant violation.
    let otc_expected = sub(hub_pot.otc_deposited_units, inflow_state.otc_claimed_units)?;
    let crclx_expected = sub(hub_pot.crclx_deposited_units, inflow_state.crclx_claimed_units)?;
    let nvdax_expected = sub(hub_pot.nvdax_deposited_units, inflow_state.nvdax_claimed_units)?;
    let spcxx_expected = sub(hub_pot.spcxx_deposited_units, inflow_state.spcxx_claimed_units)?;
    let otc_new = sub(otc_balance, otc_expected)?;
    let crclx_new = sub(crclx_balance, crclx_expected)?;
    let nvdax_new = sub(nvdax_balance, nvdax_expected)?;
    let spcxx_new = sub(spcxx_balance, spcxx_expected)?;
    require!(
        otc_new > 0 || crclx_new > 0 || nvdax_new > 0 || spcxx_new > 0,
        HubError::NoHubPotInflow
    );

    let legs: [(
        u64,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
        &UncheckedAccount,
    ); 4] = [
        (
            otc_new,
            &ctx.accounts.otc_vault,
            &ctx.accounts.otc_mint,
            &ctx.accounts.ops_otc,
            &ctx.accounts.otc_token_program,
        ),
        (
            crclx_new,
            &ctx.accounts.crclx_vault,
            &ctx.accounts.crclx_mint,
            &ctx.accounts.ops_crclx,
            &ctx.accounts.crclx_token_program,
        ),
        (
            nvdax_new,
            &ctx.accounts.nvdax_vault,
            &ctx.accounts.nvdax_mint,
            &ctx.accounts.ops_nvdax,
            &ctx.accounts.nvdax_token_program,
        ),
        (
            spcxx_new,
            &ctx.accounts.spcxx_vault,
            &ctx.accounts.spcxx_mint,
            &ctx.accounts.ops_spcxx,
            &ctx.accounts.spcxx_token_program,
        ),
    ];
    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[vault_bump]]];
    let mut to_pool = [0u64; 4];
    let mut to_ops_amounts = [0u64; 4];
    for (i, (new_amount, vault_ai, mint, ops_to, token_program)) in legs.into_iter().enumerate() {
        if new_amount == 0 {
            continue;
        }
        let to_ops = bps_of(new_amount, fee_bp)?;
        let pool_amount = sub(new_amount, to_ops)?;
        if to_ops > 0 {
            transfer_checked(
                token_program,
                vault_ai,
                mint,
                ops_to,
                &ctx.accounts.vault,
                to_ops,
                seeds,
            )?;
        }
        to_pool[i] = pool_amount;
        to_ops_amounts[i] = to_ops;
    }
    let (otc_pool, crclx_pool, nvdax_pool, spcxx_pool) =
        (to_pool[0], to_pool[1], to_pool[2], to_pool[3]);

    let p = &mut ctx.accounts.hub_pot;
    p.otc_pending_units = add(p.otc_pending_units, otc_pool)?;
    p.crclx_pending_units = add(p.crclx_pending_units, crclx_pool)?;
    p.nvdax_pending_units = add(p.nvdax_pending_units, nvdax_pool)?;
    p.spcxx_pending_units = add(p.spcxx_pending_units, spcxx_pool)?;
    p.otc_deposited_units = add(p.otc_deposited_units, otc_pool)?;
    p.crclx_deposited_units = add(p.crclx_deposited_units, crclx_pool)?;
    p.nvdax_deposited_units = add(p.nvdax_deposited_units, nvdax_pool)?;
    p.spcxx_deposited_units = add(p.spcxx_deposited_units, spcxx_pool)?;

    emit!(HubPotInflowRecognized {
        otc_recognized: otc_pool,
        crclx_recognized: crclx_pool,
        nvdax_recognized: nvdax_pool,
        spcxx_recognized: spcxx_pool,
        otc_to_ops: to_ops_amounts[0],
        crclx_to_ops: to_ops_amounts[1],
        nvdax_to_ops: to_ops_amounts[2],
        spcxx_to_ops: to_ops_amounts[3],
        otc_pending_after: p.otc_pending_units,
        crclx_pending_after: p.crclx_pending_units,
        nvdax_pending_after: p.nvdax_pending_units,
        spcxx_pending_after: p.spcxx_pending_units,
    });
    Ok(())
}
