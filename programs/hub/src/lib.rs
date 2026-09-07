//! $HUB protocol — stake-to-earn layer for OTC desk NFTs.
//! Implements docs/hubconnect-spec.md v1.2 (§B2 accounts, §B3 instructions).
//! Community tooling; not affiliated with OTC.

// anchor-lang 0.31.1's `#[program]` expansion calls the deprecated `AccountInfo::realloc`.
#![allow(deprecated)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("DPEioLagahMiVy4xfSzeKLWjWho8GZhbvK85BgTkY8qW");

#[program]
pub mod hub {
    use super::*;

    /// §B3 #1
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        instructions::admin::initialize_config(ctx, args)
    }

    /// §B3 #2
    pub fn activate_tier(ctx: Context<ActivateTier>) -> Result<()> {
        instructions::tiers::activate_tier(ctx)
    }

    /// §B3 #3
    pub fn upgrade_tier(ctx: Context<UpgradeTier>) -> Result<()> {
        instructions::tiers::upgrade_tier(ctx)
    }

    /// §B3 #4
    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>, epoch_index: u64) -> Result<()> {
        instructions::epochs::finalize_epoch(ctx, epoch_index)
    }

    /// §B3 #5 (lazy revocation → #8 void_tier)
    pub fn claim_yield(ctx: Context<ClaimYield>, epoch_index: u64) -> Result<()> {
        instructions::tiers::claim_yield(ctx, epoch_index)
    }

    /// §B3 #6
    pub fn register_treasury_inflow(
        ctx: Context<RegisterTreasuryInflow>,
        source: InflowSource,
        lamports: u64,
    ) -> Result<()> {
        instructions::epochs::register_treasury_inflow(ctx, source, lamports)
    }

    /// §B3 #7
    pub fn record_burn(
        ctx: Context<RecordBurn>,
        hub_burned: u64,
        lamports_spent: u64,
        burn_tx: [u8; 64],
    ) -> Result<()> {
        instructions::epochs::record_burn(ctx, hub_burned, lamports_spent, burn_tx)
    }

    /// §B3 #9
    pub fn update_config(
        ctx: Context<AuthorityOnly>,
        field: ConfigField,
        value: ConfigValue,
    ) -> Result<()> {
        instructions::admin::update_config(ctx, field, value)
    }

    /// §B3 #10
    pub fn pause(ctx: Context<AuthorityOnly>) -> Result<()> {
        instructions::admin::set_paused(ctx, true)
    }

    /// §B3 #10
    pub fn unpause(ctx: Context<AuthorityOnly>) -> Result<()> {
        instructions::admin::set_paused(ctx, false)
    }

    /// §B3 #11
    pub fn consign_desk(ctx: Context<ConsignDesk>) -> Result<()> {
        instructions::treasury::consign_desk(ctx)
    }

    /// §B3 #12
    pub fn unconsign_desk(ctx: Context<UnconsignDesk>) -> Result<()> {
        instructions::treasury::unconsign_desk(ctx)
    }

    /// §B3 #13
    pub fn build_lp(
        ctx: Context<BuildLp>,
        pair: LpPair,
        hub_amount: u64,
        quote_amount: u64,
    ) -> Result<()> {
        instructions::treasury::build_lp(ctx, pair, hub_amount, quote_amount)
    }
}
