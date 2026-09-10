//! $HUB Yield Optimizer Protocol — Activate-to-earn Boosted Yield layer for OTC desk NFTs on Solana.
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

declare_id!("7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i");

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

    /// §B3 #2 — fresh activation (or re-activation of a voided tier) straight into `target_tier`;
    /// flat `step_fee` SOL + the full $HUB cost of `target_tier`, burned.
    pub fn activate_tier(ctx: Context<ActivateTier>, target_tier: u8) -> Result<()> {
        instructions::tiers::activate_tier(ctx, target_tier)
    }

    /// §B3 #3 — flat `step_fee` SOL (never scales with the step size) + the $HUB cost
    /// difference for `current → target_tier`, burned.
    pub fn upgrade_tier(ctx: Context<UpgradeTier>, target_tier: u8) -> Result<()> {
        instructions::tiers::upgrade_tier(ctx, target_tier)
    }

    /// §B3 #4 / §A5 4-way split — 90% distributed to desks (unchanged mechanic); the other 10%
    /// (5% burn / 2.5% LP / 2.5% treasury float) is swapped SOL→$HUB via a two-hop synchronous
    /// Jupiter CPI executed inside this instruction: hop1 WSOL→USDC, hop2 USDC→$HUB. `ctx
    /// .remaining_accounts[..hop1_account_count]`/`hop1_data` are hop1's caller-assembled route;
    /// the remainder of `remaining_accounts`/`hop2_data` are hop2's (see
    /// `jupiter_swap::swap_exact_in`). `min_usdc_out`/`min_hub_out` floor each hop's output. The
    /// realized USDC/HUB rate this observes also refreshes `Config.tier_hub_cost_units_cached`
    /// when `sol_swapped_lamports` clears `PRICE_UPDATE_MIN_SOL_LAMPORTS` (see `epochs.rs`).
    pub fn finalize_epoch<'info>(
        ctx: Context<'info, FinalizeEpoch<'info>>,
        epoch_index: u64,
        min_usdc_out: u64,
        min_hub_out: u64,
        hop1_account_count: u16,
        hop1_data: Vec<u8>,
        hop2_data: Vec<u8>,
    ) -> Result<()> {
        instructions::epochs::finalize_epoch(
            ctx,
            epoch_index,
            min_usdc_out,
            min_hub_out,
            hop1_account_count,
            hop1_data,
            hop2_data,
        )
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

    /// §A4.1 #15 — authority toggles the $OTC payment path on/off. Pricing is a live Jupiter
    /// quote supplied per-call (`otc_swap_amount`), not a stored rate.
    pub fn set_otc_payments_enabled(
        ctx: Context<SetOtcPaymentsEnabled>,
        enabled: bool,
    ) -> Result<()> {
        instructions::otc_pay::set_otc_payments_enabled(ctx, enabled)
    }

    /// §A4.1 #16 — `activate_tier` paid in $OTC at the 2× premium: `otc_swap_amount` swapped
    /// $OTC→$HUB via Jupiter (`min_out = hub_cost_delta`, burned in full) + an equal-scaled
    /// amount injected into the $OTC yield vault (`OtcPotState`, no swap).
    pub fn activate_tier_otc<'info>(
        ctx: Context<'info, ActivateTierOtc<'info>>,
        target_tier: u8,
        otc_swap_amount: u64,
        jupiter_data: Vec<u8>,
    ) -> Result<()> {
        instructions::otc_pay::activate_tier_otc(ctx, target_tier, otc_swap_amount, jupiter_data)
    }

    /// §A4.1 #17 — `upgrade_tier` paid in $OTC at the 2× premium (see `activate_tier_otc`).
    pub fn upgrade_tier_otc<'info>(
        ctx: Context<'info, UpgradeTierOtc<'info>>,
        target_tier: u8,
        otc_swap_amount: u64,
        jupiter_data: Vec<u8>,
    ) -> Result<()> {
        instructions::otc_pay::upgrade_tier_otc(ctx, target_tier, otc_swap_amount, jupiter_data)
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

    /// §A7.1 #20b — authority pushes a snapshot allocation straight to the desk's current owner
    /// (genesis "1-time 1-address" distribution); shares the same `AirdropClaim` PDA guard as
    /// `claim_airdrop`, so a desk can only ever be paid once regardless of the path used.
    pub fn distribute_airdrop(
        ctx: Context<DistributeAirdrop>,
        amount_units: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::tokenomics::distribute_airdrop(ctx, amount_units, proof)
    }

    /// §A5 #21 — authority creates the $OTC yield-vault bookkeeping (one-time, post-init).
    pub fn init_otc_pot(ctx: Context<InitOtcPot>, keeper: Pubkey) -> Result<()> {
        instructions::otc_pot::init_otc_pot(ctx, keeper)
    }

    /// §A5 #22 — keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports`.
    pub fn record_otc_buy(
        ctx: Context<RecordOtcBuy>,
        otc_bought: u64,
        lamports_spent: u64,
        buy_tx: [u8; 64],
    ) -> Result<()> {
        instructions::otc_pot::record_otc_buy(ctx, otc_bought, lamports_spent, buy_tx)
    }

    /// §A6.2 phase-2 — Raydium CP-Swap `deposit` + `lock_cp_liquidity` for the HUB/OTC pair:
    /// deposits, then burns the LP mint in the same tx while retaining a permanent fee claim.
    pub fn build_lp_otc_locked(
        ctx: Context<BuildLpOtcLocked>,
        hub_amount: u64,
        otc_amount: u64,
        lp_token_amount: u64,
        deposit_account_count: u8,
        with_metadata: bool,
    ) -> Result<()> {
        instructions::treasury::build_lp_otc_locked(
            ctx,
            hub_amount,
            otc_amount,
            lp_token_amount,
            deposit_account_count,
            with_metadata,
        )
    }

    /// §A6.2 phase-2 auto-compounder — permissionless: deposits the *entire*
    /// `TreasuryState.lp_pending_hub_units` earmark every call (uncapped — locked forever, only
    /// ever grows). Any keeper may call it once the pending earmark clears
    /// `LP_COMPOUND_MIN_HUB_UNITS`.
    pub fn compound_lp_otc(
        ctx: Context<CompoundLpOtc>,
        otc_amount: u64,
        lp_token_amount: u64,
        deposit_account_count: u8,
        with_metadata: bool,
    ) -> Result<()> {
        instructions::treasury::compound_lp_otc(
            ctx,
            otc_amount,
            lp_token_amount,
            deposit_account_count,
            with_metadata,
        )
    }

    /// §A5.1 basket extension of `build_lp_otc_locked` — treasury-signed, seeds (or tops up)
    /// one of the three MemeStock basket pairs' (HUB/CRCLx, HUB/OpenAI, HUB/Anthropic) locked
    /// Raydium CP-Swap position.
    pub fn build_lp_basket_locked(
        ctx: Context<BuildLpBasketLocked>,
        pair: LpPair,
        hub_amount: u64,
        quote_amount: u64,
        lp_token_amount: u64,
        deposit_account_count: u8,
        with_metadata: bool,
    ) -> Result<()> {
        instructions::treasury::build_lp_basket_locked(
            ctx,
            pair,
            hub_amount,
            quote_amount,
            lp_token_amount,
            deposit_account_count,
            with_metadata,
        )
    }

    /// §A5.1 basket sibling of `compound_lp_otc` — permissionless, uncapped, deposits the
    /// entire `TreasuryState.lp_basket_pending_hub_units[pair]` earmark (fed by
    /// `harvest_lp_fees`, not `finalize_epoch`) once it clears `LP_COMPOUND_MIN_HUB_UNITS`.
    pub fn compound_lp_basket(
        ctx: Context<CompoundLpBasket>,
        pair: LpPair,
        quote_amount: u64,
        lp_token_amount: u64,
        deposit_account_count: u8,
        with_metadata: bool,
    ) -> Result<()> {
        instructions::treasury::compound_lp_basket(
            ctx,
            pair,
            quote_amount,
            lp_token_amount,
            deposit_account_count,
            with_metadata,
        )
    }

    /// §A5.1/§A6.2 yield leg — permissionless harvest of a locked position's accrued Raydium
    /// CP-Swap trading fees. The HUB-side leg feeds back into `pair`'s own pending compounding
    /// earmark; the quote-side leg (OTC/CRCLx/OpenAI-stock/Anthropic-stock) is credited straight
    /// into `HubPotConfig`'s matching bucket, routing real yield back to desk-holders.
    pub fn harvest_lp_fees(ctx: Context<HarvestLpFees>, pair: LpPair) -> Result<()> {
        instructions::treasury::harvest_lp_fees(ctx, pair)
    }

    /// §A6.3/§A7.1 bridge — authority records the vault-owned WSOL scratch, $HUB scratch, and
    /// $HUB buy-and-hold float ATAs `finalize_epoch`'s synchronous Jupiter legs need (one-time,
    /// post-init, mirrors `init_otc_pot`).
    pub fn init_treasury_float(ctx: Context<InitTreasuryFloat>) -> Result<()> {
        instructions::treasury::init_treasury_float(ctx)
    }

    /// §A6.3/§A7.1 bridge — treasury multisig retunes the experimental treasury-float cap
    /// (bp of $HUB max supply). Excess over the live cap at deposit time is burned, never
    /// rejected.
    pub fn set_treasury_float_cap_bp(
        ctx: Context<SetTreasuryFloatCapBp>,
        hub_float_cap_bp: u16,
    ) -> Result<()> {
        instructions::treasury::set_treasury_float_cap_bp(ctx, hub_float_cap_bp)
    }

    /// §A6.3 #23 — authority creates the creator-fee flywheel bookkeeping (one-time, post-init).
    pub fn init_creator_fee_state(
        ctx: Context<InitCreatorFeeState>,
        keeper: Pubkey,
        clear_threshold_units: u64,
    ) -> Result<()> {
        instructions::creator_fee::init_creator_fee_state(ctx, keeper, clear_threshold_units)
    }

    /// §A6.3 #24 — treasury deposits its claimed launcher holder-leg $OTC (enforced deposit).
    pub fn record_creator_fee(ctx: Context<RecordCreatorFee>, otc_received: u64) -> Result<()> {
        instructions::creator_fee::record_creator_fee(ctx, otc_received)
    }

    /// §A6.3 #25 — permissionless: splits the pending balance 80/5/5/5/5 once it clears the
    /// threshold; the 80% desk-pot leg is injected into `OtcPotState` in the same instruction.
    pub fn clear_creator_fees(ctx: Context<ClearCreatorFees>) -> Result<()> {
        instructions::creator_fee::clear_creator_fees(ctx)
    }

    /// §A6.3 #26 — keeper draws a leg's earmarked $OTC to execute its off-chain swap.
    pub fn draw_creator_fee_leg(
        ctx: Context<DrawCreatorFeeLeg>,
        leg: CreatorFeeLeg,
        otc_amount: u64,
    ) -> Result<()> {
        instructions::creator_fee::draw_creator_fee_leg(ctx, leg, otc_amount)
    }

    /// §A6.3 #27 — attests a burn executed off-chain from a drawn `Burn` leg.
    pub fn record_creator_fee_burn_result(
        ctx: Context<RecordCreatorFeeBurnResult>,
        otc_spent: u64,
        hub_burned: u64,
        burn_tx: [u8; 64],
    ) -> Result<()> {
        instructions::creator_fee::record_creator_fee_burn_result(
            ctx, otc_spent, hub_burned, burn_tx,
        )
    }

    /// §A6.3 #28 — attests $HUB stacked into the treasury float from a drawn `Stack` leg.
    pub fn record_creator_fee_stack(
        ctx: Context<RecordCreatorFeeStack>,
        otc_spent: u64,
        hub_amount: u64,
        stack_tx: [u8; 64],
    ) -> Result<()> {
        instructions::creator_fee::record_creator_fee_stack(ctx, otc_spent, hub_amount, stack_tx)
    }

    /// §A6.3 #29 — enforced: keeper's post-swap SOL lands in `ops_wallet` in the same tx.
    pub fn record_creator_fee_ops(
        ctx: Context<RecordCreatorFeeOps>,
        otc_spent: u64,
        sol_amount: u64,
    ) -> Result<()> {
        instructions::creator_fee::record_creator_fee_ops(ctx, otc_spent, sol_amount)
    }

    /// §A6.3/§A7.1 bridge #30 — treasury deposits $HUB (swapped off-chain from the OTC launcher's
    /// holders-in-stock reward leg) into `treasury_lock_vault` (enforced deposit), earmarked for
    /// the next `open_reward_round`.
    pub fn fund_treasury_reward(ctx: Context<FundTreasuryReward>, hub_amount: u64) -> Result<()> {
        instructions::tokenomics::fund_treasury_reward(ctx, hub_amount)
    }

    /// #31 — permissionless: snapshots the pending reward deposit across the live Σw of active
    /// desks into a new `RewardRound`.
    pub fn open_reward_round(ctx: Context<OpenRewardRound>) -> Result<()> {
        instructions::tokenomics::open_reward_round(ctx)
    }

    /// #32 — authority pushes one active desk's tier-weighted share of an open `RewardRound`
    /// straight to its current owner; capped so a round can never pay out more than it holds.
    pub fn distribute_treasury_reward(
        ctx: Context<DistributeTreasuryReward>,
        round_index: u32,
    ) -> Result<()> {
        instructions::tokenomics::distribute_treasury_reward(ctx, round_index)
    }

    /// §A5.1 #33 — authority creates the HUB Pot MemeStock basket bookkeeping (one-time,
    /// post-init); records the 4 basket mints (resolved at call time, never hardcoded) + their
    /// vault-owned token accounts.
    pub fn init_hub_pot(
        ctx: Context<InitHubPot>,
        otc_mint: Pubkey,
        crclx_mint: Pubkey,
        openai_mint: Pubkey,
        anthropic_mint: Pubkey,
    ) -> Result<()> {
        instructions::hub_pot::init_hub_pot(ctx, otc_mint, crclx_mint, openai_mint, anthropic_mint)
    }

    /// §A5.1 #34 — treasury deposits the 4 already-converted basket amounts (swapped off-chain
    /// from source-B's 13-stock treasury-desk claim) in one instruction — four enforced
    /// `TransferChecked` deposits, not merely attested.
    pub fn fund_hub_pot(
        ctx: Context<FundHubPot>,
        otc_amount: u64,
        crclx_amount: u64,
        openai_amount: u64,
        anthropic_amount: u64,
    ) -> Result<()> {
        instructions::hub_pot::fund_hub_pot(
            ctx,
            otc_amount,
            crclx_amount,
            openai_amount,
            anthropic_amount,
        )
    }

    /// §A5.1 #35 — permissionless: snapshots all 4 pending bucket balances across the live Σw
    /// of active desks into a new `HubPotRound`.
    pub fn open_hub_pot_round(ctx: Context<OpenHubPotRound>) -> Result<()> {
        instructions::hub_pot::open_hub_pot_round(ctx)
    }

    /// §A5.1 #36 — authority pushes one active desk's tier-weighted share of all 4 open
    /// `HubPotRound` buckets straight to its current owner in a single transaction (4
    /// `transfer_checked` CPIs); each bucket independently capped so it can never pay out more
    /// than that bucket's snapshotted amount.
    pub fn distribute_hub_pot_reward(
        ctx: Context<DistributeHubPotReward>,
        round_index: u32,
    ) -> Result<()> {
        instructions::hub_pot::distribute_hub_pot_reward(ctx, round_index)
    }

    /// §A5.1 #37 — a desk's current owner pulls its own tier-weighted share of all 4 open
    /// `HubPotRound` buckets ("M.I.M ETF" — $OTC/CRCLx/OpenAI/Anthropic), self-signed; shares the
    /// same `HubPotClaim` PDA as `distribute_hub_pot_reward` so a desk can only ever be paid once
    /// per round regardless of which path is used (mirrors `claim_airdrop`/`distribute_airdrop`).
    pub fn claim_hub_pot_reward(ctx: Context<ClaimHubPotReward>, round_index: u32) -> Result<()> {
        instructions::hub_pot::claim_hub_pot_reward(ctx, round_index)
    }

    /// Devnet-only: closes `config`/`burn`/`treasury_state`/`epoch(epoch_index)` so
    /// `initialize_config` can re-`init` the same PDAs after a layout change. Compiled only
    /// under the `mock-jupiter` feature — absent from every mainnet build.
    #[cfg(feature = "mock-jupiter")]
    pub fn devnet_reset(ctx: Context<DevnetReset>, epoch_index: u64) -> Result<()> {
        instructions::admin::devnet_reset(ctx, epoch_index)
    }
}
