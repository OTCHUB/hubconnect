//! $HUB protocol — stake-to-earn layer for OTC desk NFTs.
//! Implements docs/hubconnect-spec.md v1.2 (§B2 accounts, §B3 instructions).
//! Community tooling; not affiliated with OTC.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv");

// https://github.com/neodyme-labs/solana-security-txt — embedded in the .so so explorers and
// researchers can find the disclosure channel from the on-chain binary alone.
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "HUB Protocol",
    project_url: "https://github.com/OTCHUB/hubconnect",
    contacts: "link:https://github.com/OTCHUB/hubconnect/security/advisories/new",
    policy: "https://github.com/OTCHUB/hubconnect/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/OTCHUB/hubconnect",
    auditors: "None"
}

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

    /// §B3 #3 — pays exactly `(target_tier - current) × step_fee`.
    pub fn upgrade_tier(ctx: Context<UpgradeTier>, target_tier: u8) -> Result<()> {
        instructions::tiers::upgrade_tier(ctx, target_tier)
    }

    /// §B3 #4
    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>, epoch_index: u64) -> Result<()> {
        instructions::epochs::finalize_epoch(ctx, epoch_index)
    }

    /// §B3 #5 (lazy revocation → #8 void_tier). One tx settles every closed round.
    pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
        instructions::tiers::claim_yield(ctx)
    }

    /// §B3 #6
    pub fn register_treasury_inflow(
        ctx: Context<RegisterTreasuryInflow>,
        source: InflowSource,
        lamports: u64,
    ) -> Result<()> {
        instructions::epochs::register_treasury_inflow(ctx, source, lamports)
    }

    /// §B3 #6, source E — consignor-share split (§A6.1).
    pub fn register_consigned_inflow(
        ctx: Context<RegisterConsignedInflow>,
        lamports: u64,
    ) -> Result<()> {
        instructions::epochs::register_consigned_inflow(ctx, lamports)
    }

    /// Pays a wallet-level StakerAccrual (consignor share credits).
    pub fn claim_accrual(ctx: Context<ClaimAccrual>) -> Result<()> {
        instructions::epochs::claim_accrual(ctx)
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

    /// §A4.1 #14 — authority creates the $OTC payment config + POL reserve pointer (disabled).
    pub fn init_otc_payments(ctx: Context<InitOtcPayments>) -> Result<()> {
        instructions::otc_pay::init_otc_payments(ctx)
    }

    /// §A4.1 #15 — authority refreshes the $OTC/SOL reference rate and the enable switch.
    pub fn set_otc_rate(ctx: Context<SetOtcRate>, otc_per_sol: u64, enabled: bool) -> Result<()> {
        instructions::otc_pay::set_otc_rate(ctx, otc_per_sol, enabled)
    }

    /// §A4.1 #16 — `activate_tier` paid in $OTC at the 2× premium; proceeds → POL reserve.
    pub fn activate_tier_otc(ctx: Context<ActivateTierOtc>) -> Result<()> {
        instructions::otc_pay::activate_tier_otc(ctx)
    }

    /// §A4.1 #17 — `upgrade_tier` paid in $OTC at the 2× premium; proceeds → POL reserve.
    pub fn upgrade_tier_otc(ctx: Context<UpgradeTierOtc>, target_tier: u8) -> Result<()> {
        instructions::otc_pay::upgrade_tier_otc(ctx, target_tier)
    }

    /// §A7.1 #18 — authority records the supply plan + the vault $HUB account funding the airdrop.
    pub fn init_tokenomics(ctx: Context<InitTokenomics>) -> Result<()> {
        instructions::tokenomics::init_tokenomics(ctx)
    }

    /// §A7.1 #19 — authority publishes the desk-snapshot Merkle root and opens/closes claims.
    pub fn set_airdrop_root(
        ctx: Context<SetAirdropRoot>,
        root: [u8; 32],
        desk_count: u32,
        open: bool,
    ) -> Result<()> {
        instructions::tokenomics::set_airdrop_root(ctx, root, desk_count, open)
    }

    /// §A7.1 #20 — a desk's current owner claims its snapshot allocation (one claim per asset).
    pub fn claim_airdrop(
        ctx: Context<ClaimAirdrop>,
        amount_units: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::tokenomics::claim_airdrop(ctx, amount_units, proof)
    }
}
