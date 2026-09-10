//! §B3 #1 initialize_config, #9 update_config, #10 pause/unpause.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HubError;
use crate::instructions::pot::transfer_from_signer;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub ops_wallet: Pubkey,
    pub treasury: Pubkey,
    pub otc_program: Pubkey,
    pub otc_desk_pot: Pubkey,
    pub desk_collection: Pubkey,
    pub hub_mint: Pubkey,
    pub otc_mint: Pubkey,
    /// USDC mint for `finalize_epoch`'s two-hop price-discovery swap.
    pub usdc_mint: Pubkey,
    /// 0 → Appendix default (MIN_POT_THRESHOLD_LAMPORTS = 0.1 SOL).
    pub min_pot_threshold_lamports: u64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: system-owned lamport vault PDA; no data. Funded with the rent floor here.
    #[account(mut, seeds = [SEED_POT], bump)]
    pub pot: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + BurnState::INIT_SPACE, seeds = [SEED_BURN], bump)]
    pub burn: Account<'info, BurnState>,
    #[account(init, payer = payer, space = 8 + TreasuryState::INIT_SPACE, seeds = [SEED_TREASURY], bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA for treasury-side token positions (LP, §A6.2).
    #[account(seeds = [SEED_VAULT], bump)]
    pub vault: UncheckedAccount<'info>,
    /// Genesis epoch — the open epoch must always exist (§B3 #4 roll-forward chain).
    #[account(init, payer = payer, space = 8 + Epoch::INIT_SPACE, seeds = [SEED_EPOCH, &0u64.to_le_bytes()], bump)]
    pub epoch0: Account<'info, Epoch>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let threshold = if args.min_pot_threshold_lamports == 0 {
        MIN_POT_THRESHOLD_LAMPORTS
    } else {
        args.min_pot_threshold_lamports
    };

    // Rent-exempt floor so the pot can be drained to exactly its liability.
    let floor = Rent::get()?.minimum_balance(0);
    if ctx.accounts.pot.lamports() < floor {
        transfer_from_signer(
            &ctx.accounts.system_program,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.pot.to_account_info(),
            floor - ctx.accounts.pot.lamports(),
        )?;
    }

    let e = &mut ctx.accounts.epoch0;
    e.index = 0;
    e.start_ts = now;
    e.finalized_ts = 0;
    e.bump = ctx.bumps.epoch0;

    let c = &mut ctx.accounts.config;
    c.authority = ctx.accounts.payer.key();
    c.pot = ctx.accounts.pot.key();
    c.ops_wallet = args.ops_wallet;
    c.treasury = args.treasury;
    c.otc_program = args.otc_program;
    c.otc_desk_pot = args.otc_desk_pot;
    c.desk_collection = args.desk_collection;
    c.hub_mint = args.hub_mint;
    c.otc_mint = args.otc_mint;
    c.usdc_mint = args.usdc_mint;
    c.tier_weights_bp = TIER_WEIGHTS_BP;
    c.step_fee_lamports = STEP_FEE_LAMPORTS;
    c.tier_usd_cost_micros = TIER_USD_COST_MICROS;
    c.tier_hub_cost_units_cached = TIER_HUB_COST_UNITS;
    c.last_price_update_ts = 0;
    c.tier_cost_burn_bp = TIER_COST_BURN_BP;
    c.min_pot_threshold_lamports = threshold;
    c.burn_pct_bp = BURN_PCT_BP;
    c.lp_pct_bp = LP_PCT_BP;
    c.treasury_float_pct_bp = TREASURY_FLOAT_PCT_BP;
    c.ops_pct_bp = OPS_PCT_BP;
    c.protocol_fee_bp = PROTOCOL_FEE_BP;
    c.lp_enabled = LP_ENABLED;
    c.lp_target_sol_lamports = LP_TARGET_SOL_LAMPORTS;
    c.lp_phase2_open_ts = 0;
    c.paused = false;
    c.current_epoch = 0;
    c.genesis_ts = now;
    c.total_weight_bp = 0;
    c.pot_liability_lamports = 0;
    c.acc_per_weight = 0;
    c.dust_scaled = 0;
    c.bump = ctx.bumps.config;
    c.pot_bump = ctx.bumps.pot;

    let b = &mut ctx.accounts.burn;
    b.authority = ctx.accounts.payer.key();
    b.total_hub_burned = 0;
    b.last_burn_tx = [0u8; 64];
    b.bump = ctx.bumps.burn;

    let t = &mut ctx.accounts.treasury_state;
    t.multisig = args.treasury;
    t.vault = ctx.accounts.vault.key();
    t.vault_bump = ctx.bumps.vault;
    t.desks_owned = 0;
    t.sweep_budget_cap_bp = SWEEP_BUDGET_CAP_BP;
    t.sweep_payback_cap_lamports = SWEEP_PAYBACK_CAP_LAMPORTS;
    t.exit_discount_bp = EXIT_DISCOUNT_BP;
    t.exit_hub_leg_bp = EXIT_HUB_LEG_BP;
    t.floor_staleness_bp = FLOOR_STALENESS_BP;
    t.hub_float_cap_bp = TREASURY_HUB_FLOAT_CAP_BP;
    t.total_exits = 0;
    t.total_sweeps = 0;
    t.lp_pending_hub_units = 0;
    // Set by `init_treasury_float` once the vault-owned WSOL/USDC/HUB scratch and float ATAs exist.
    t.vault_wsol = Pubkey::default();
    t.vault_usdc = Pubkey::default();
    t.vault_hub = Pubkey::default();
    t.treasury_float_vault = Pubkey::default();
    t.treasury_float_units = 0;
    t.bump = ctx.bumps.treasury_state;
    Ok(())
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
}

/// Devnet-only escape hatch: closes the four singleton PDAs `initialize_config` creates with
/// `init` (`config`/`burn`/`treasury_state`/current `epoch`) so a fresh `initialize_config` can
/// reclaim the same addresses after a breaking `Config`/`Epoch`/`TreasuryState`/`BurnState`
/// layout change on an already-provisioned devnet deploy. Gated behind the same `mock-jupiter`
/// feature as the rest of the devnet-only surface — never compiled into a mainnet build, so
/// there is no way to wipe a live deployment's state. `DeskTier`/`OtcPotState`/mints are left
/// untouched; re-run `devnet-hub-mint`/`devnet-otc-mint`/`devnet-mock-desks` after this.
///
/// Every account here is `UncheckedAccount`, not the typed `Account<'info, T>`: the whole point
/// of this instruction is recovering from an on-chain layout the *current* struct definitions
/// can no longer deserialize (the exact "AccountDidNotDeserialize"/"Invalid bool: N" this exists
/// to get past), so the handler reads only the one field guaranteed stable across every layout
/// version — `Config.authority`, always the first field at fixed offset 8 — directly off the
/// raw bytes instead of going through a typed decode.
#[cfg(feature = "mock-jupiter")]
#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct DevnetReset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: raw close target; see the module doc above.
    #[account(mut, seeds = [SEED_CONFIG], bump)]
    pub config: UncheckedAccount<'info>,
    /// CHECK: raw close target; see the module doc above.
    #[account(mut, seeds = [SEED_BURN], bump)]
    pub burn: UncheckedAccount<'info>,
    /// CHECK: raw close target; see the module doc above.
    #[account(mut, seeds = [SEED_TREASURY], bump)]
    pub treasury_state: UncheckedAccount<'info>,
    /// CHECK: raw close target; see the module doc above.
    #[account(mut, seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump)]
    pub epoch: UncheckedAccount<'info>,
}

/// Devnet-only escape hatch: closes a single stale `Epoch[epoch_index]` PDA left over from an
/// earlier test session, without touching `config`/`burn`/`treasury_state` (unlike
/// `DevnetReset`, which always bundles all four). Needed because `finalize_epoch` `init`s
/// `Epoch[current_epoch + 1]` — if a prior run already created that address (e.g. before a
/// `DevnetReset` that only closed the then-current epoch), the `init` fails with "already in
/// use" even though `config`/`burn`/`treasury_state` are fine. Same gating and authority check
/// as `DevnetReset`.
#[cfg(feature = "mock-jupiter")]
#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct DevnetCloseEpoch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: raw close target; see the module doc above.
    #[account(mut, seeds = [SEED_EPOCH, &epoch_index.to_le_bytes()], bump)]
    pub epoch: UncheckedAccount<'info>,
}

#[cfg(feature = "mock-jupiter")]
pub fn devnet_close_epoch(ctx: Context<DevnetCloseEpoch>, _epoch_index: u64) -> Result<()> {
    let dest = ctx.accounts.authority.to_account_info();
    close_raw(&ctx.accounts.epoch.to_account_info(), &dest)
}

/// Zeroes an account's data and sweeps its lamports to `dest`. Draining lamports to 0 is what
/// actually frees the address for a later `init` — the Solana runtime purges any account with a
/// zero balance at the end of the transaction that left it that way, regardless of its data or
/// owner — so the data-zeroing here is just defense in depth against a same-block resurrection
/// read, not load-bearing. A no-op on an already-empty (0-lamport) account, so re-running
/// `devnet_reset` is safe.
#[cfg(feature = "mock-jupiter")]
fn close_raw(info: &AccountInfo, dest: &AccountInfo) -> Result<()> {
    if info.lamports() == 0 {
        return Ok(());
    }
    **dest.try_borrow_mut_lamports()? = dest
        .lamports()
        .checked_add(info.lamports())
        .ok_or(HubError::MathOverflow)?;
    **info.try_borrow_mut_lamports()? = 0;
    info.try_borrow_mut_data()?.fill(0);
    Ok(())
}

#[cfg(feature = "mock-jupiter")]
pub fn devnet_reset(ctx: Context<DevnetReset>, _epoch_index: u64) -> Result<()> {
    let config_ai = ctx.accounts.config.to_account_info();
    if config_ai.lamports() > 0 {
        let data = config_ai.try_borrow_data()?;
        require!(data.len() >= 40, HubError::Unauthorized);
        let stored_authority =
            Pubkey::try_from(&data[8..40]).map_err(|_| HubError::Unauthorized)?;
        drop(data);
        require_keys_eq!(
            stored_authority,
            ctx.accounts.authority.key(),
            HubError::Unauthorized
        );
    }
    let dest = ctx.accounts.authority.to_account_info();
    close_raw(&config_ai, &dest)?;
    close_raw(&ctx.accounts.burn.to_account_info(), &dest)?;
    close_raw(&ctx.accounts.treasury_state.to_account_info(), &dest)?;
    close_raw(&ctx.accounts.epoch.to_account_info(), &dest)?;
    Ok(())
}

fn bps(v: &ConfigValue) -> Result<u16> {
    match v {
        ConfigValue::U16(x) if *x <= BPS_DENOMINATOR as u16 => Ok(*x),
        _ => err!(HubError::BpsOutOfRange),
    }
}

fn pk(v: &ConfigValue) -> Result<Pubkey> {
    match v {
        ConfigValue::Pubkey(p) => Ok(*p),
        _ => err!(HubError::FieldNotUpdatable),
    }
}

fn flag(v: &ConfigValue) -> Result<bool> {
    match v {
        ConfigValue::Bool(b) => Ok(*b),
        _ => err!(HubError::FieldNotUpdatable),
    }
}

/// Rate changes only affect epochs finalized after this call (§B3 #9).
pub fn update_config(
    ctx: Context<AuthorityOnly>,
    field: ConfigField,
    value: ConfigValue,
) -> Result<()> {
    let c = &mut ctx.accounts.config;
    match field {
        ConfigField::OpsWallet => c.ops_wallet = pk(&value)?,
        ConfigField::OtcProgram => c.otc_program = pk(&value)?,
        ConfigField::OtcDeskPot => c.otc_desk_pot = pk(&value)?,
        ConfigField::DeskCollection => c.desk_collection = pk(&value)?,
        ConfigField::HubMint => c.hub_mint = pk(&value)?,
        ConfigField::OtcMint => c.otc_mint = pk(&value)?,
        ConfigField::UsdcMint => c.usdc_mint = pk(&value)?,
        ConfigField::TierCostBurnBp => c.tier_cost_burn_bp = bps(&value)?,
        ConfigField::Authority => c.authority = pk(&value)?,
        ConfigField::BurnPctBp => c.burn_pct_bp = bps(&value)?,
        ConfigField::LpPctBp => c.lp_pct_bp = bps(&value)?,
        ConfigField::TreasuryFloatPctBp => c.treasury_float_pct_bp = bps(&value)?,
        ConfigField::OpsPctBp => c.ops_pct_bp = bps(&value)?,
        ConfigField::ProtocolFeeBp => c.protocol_fee_bp = bps(&value)?,
        ConfigField::LpEnabled => c.lp_enabled = flag(&value)?,
        ConfigField::Treasury => c.treasury = pk(&value)?,
        ConfigField::LpTargetSolLamports => c.lp_target_sol_lamports = u64v(&value)?,
        ConfigField::MinPotThresholdLamports => {
            let v = u64v(&value)?;
            require!(v > 0, HubError::ZeroAmount);
            c.min_pot_threshold_lamports = v;
        }
        ConfigField::LpPhase2OpenTs => match value {
            ConfigValue::I64(x) => c.lp_phase2_open_ts = x,
            _ => return err!(HubError::FieldNotUpdatable),
        },
    }
    Ok(())
}

fn u64v(v: &ConfigValue) -> Result<u64> {
    match v {
        ConfigValue::U64(x) => Ok(*x),
        _ => err!(HubError::FieldNotUpdatable),
    }
}

pub fn set_paused(ctx: Context<AuthorityOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}
