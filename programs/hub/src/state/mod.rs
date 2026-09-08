//! §B2 on-chain accounts. All amounts in lamports; all rates in basis points.
//! Every OTC-side address lives in `Config` (authority-resolvable), never compiled in.

use anchor_lang::prelude::*;

use crate::constants::TIER_COUNT;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub pot: Pubkey,
    pub ops_wallet: Pubkey,
    pub treasury: Pubkey,
    /// OTC-side references resolved at runtime (§A2), never hardcoded.
    pub otc_program: Pubkey,
    pub otc_desk_pot: Pubkey,
    pub desk_collection: Pubkey,
    pub hub_mint: Pubkey,
    pub otc_mint: Pubkey,
    pub tier_weights_bp: [u16; TIER_COUNT],
    pub step_fee_lamports: u64,
    /// $HUB base units required to reach each tier from scratch (cumulative table).
    pub tier_hub_cost_units: [u64; TIER_COUNT],
    /// A round closes once the open epoch's inflow reaches this (no clock involved).
    pub min_pot_threshold_lamports: u64,
    pub burn_pct_bp: u16,
    /// §A5 5%: earmarked at finalize into `TreasuryState.lp_pending_lamports` for the
    /// $HUB/$OTC LP (phase-2 `build_lp`). Remainder after burn + lp is the 90% $OTC leg.
    pub lp_pct_bp: u16,
    pub ops_pct_bp: u16,
    pub lp_enabled: bool,
    pub lp_target_sol_lamports: u64,
    /// §A6.2 phase-2 gate: HUB/OTC LP opens only after this timestamp (0 = closed).
    pub lp_phase2_open_ts: i64,
    pub paused: bool,
    /// Index of the open (accruing) epoch; `Epoch[current_epoch]` always exists.
    pub current_epoch: u64,
    pub genesis_ts: i64,
    /// Running Σw (bp) of non-voided DeskTiers; snapshotted into `Epoch` at finalize.
    pub total_weight_bp: u64,
    /// Lamports the pot owes (unclaimed allotments + burn-pending + carry). Pot ≥ this, always.
    pub pot_liability_lamports: u64,
    /// Cumulative lamports × ACC_SCALE credited per bp of weight (OTC "counter"). A tier's
    /// pending yield is `(acc − stamp) × w / ACC_SCALE`, so one claim settles every round.
    pub acc_per_weight: u128,
    /// Scaled lamports credited to the accumulator but owed to nobody (claim floor remainders,
    /// ceil slack at finalize, forfeits of voided tiers). Whole lamports re-enter as inflow at
    /// the next finalize, so the pot stays zero-sum.
    pub dust_scaled: u128,
    pub bump: u8,
    pub pot_bump: u8,
}

/// One round of the pot. Opens at the previous finalize, closes when inflow ≥ threshold.
#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub index: u64,
    pub start_ts: i64,
    /// 0 while open.
    pub finalized_ts: i64,
    pub inflow_lamports: u64,
    /// Lamports credited to stakers through `acc_per_weight` at finalize (§A5 90% $OTC leg,
    /// lamport-equivalent value — `claim_yield` converts it to $OTC at the pot's lifetime
    /// average buy rate).
    pub distributed_lamports: u64,
    pub burn_pending_lamports: u64,
    /// §A5 5% — this round's LP-build earmark, added to `TreasuryState.lp_pending_lamports`.
    pub lp_pending_lamports: u64,
    /// `distributable − distributed` (≤ 1 lamport of floor loss) → next epoch's opening inflow.
    pub rolled_forward_lamports: u64,
    /// Σw of non-voided DeskTiers at finalize (bp-weighted).
    pub total_weight_bp: u64,
    /// This round's increment of `acc_per_weight` and the counter value after it.
    pub per_weight_scaled: u128,
    pub acc_per_weight_after: u128,
    pub finalized: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DeskTier {
    pub asset_id: Pubkey,
    /// Owner at activation; re-verified lazily at claim/upgrade (§B3 #5).
    pub owner_at_activation: Pubkey,
    pub tier: u8,
    pub activated_epoch: u64,
    /// `Config.acc_per_weight` at activation / last claim (OTC "stamp").
    pub stamp_acc_per_weight: u128,
    /// Lifetime SOL this desk has been paid by `claim_yield` (reset on re-activation).
    pub total_claimed_lamports: u64,
    pub voided: bool,
    pub bump: u8,
}

/// `Pot` is a system-owned PDA (`["pot"]`); balance = account lamports. It has
/// no data — liability is tracked on `Burn`/`Epoch` and Σ StakerAccrual.
#[account]
#[derive(InitSpace)]
pub struct BurnState {
    pub authority: Pubkey,
    pub total_hub_burned: u64,
    pub burn_pending_lamports: u64,
    pub last_burn_tx: [u8; 64],
    pub bump: u8,
}

/// §A5 90% leg — `["otc_pot"]`. Created by the authority after `initialize_config` (same
/// no-migration pattern as `OtcPayConfig`). `otc_vault` (mint = `Config.otc_mint`, owner =
/// `["pot"]` PDA) is the program-custodied inventory `claim_yield` pays desks from.
/// `record_otc_buy` is a keeper-attested reimbursement (mirrors `BurnState`): the keeper fronts
/// SOL, buys $OTC on the market, deposits it into `otc_vault` in the same tx (`TransferChecked`,
/// enforced on-chain — not merely attested), then is reimbursed from the pot up to
/// `otc_pending_lamports`. `claim_yield` prices each desk's lamport-equivalent entitlement
/// (`acc_per_weight` counter, unchanged) in $OTC at the lifetime average rate
/// `total_otc_bought_units / total_lamports_spent`, so buys can batch/lag epochs without
/// breaking per-round weight fairness.
#[account]
#[derive(InitSpace)]
pub struct OtcPotState {
    pub authority: Pubkey,
    pub otc_vault: Pubkey,
    /// SOL earmarked by `finalize_epoch` for $OTC buys, not yet drawn by `record_otc_buy`.
    pub otc_pending_lamports: u64,
    /// Lifetime cumulative SOL spent buying $OTC (denominator of the average rate).
    pub total_lamports_spent: u64,
    /// Lifetime cumulative $OTC bought (numerator of the average rate).
    pub total_otc_bought_units: u64,
    pub last_buy_tx: [u8; 64],
    pub bump: u8,
}

/// §A6.3 second flywheel — `["creator_fee"]`. Created by the authority after `initialize_config`
/// (same no-migration pattern as `OtcPotState`). `creator_fee_vault` (mint = `Config.otc_mint`,
/// owner = `["pot"]` PDA — same custody PDA as `otc_vault`) holds the treasury's pro-rata claim
/// on the OTC launcher's 70% holders-in-stock leg, deposited via `record_creator_fee`
/// (`TransferChecked`, enforced). Once `pending_otc_units ≥ clear_threshold_units`,
/// `clear_creator_fees` splits the whole pending balance 80/5/5/5/5 into five earmarks: the 80%
/// desk-pot leg is injected into `OtcPotState` in the same instruction (no swap — it's already
/// $OTC, so it only raises `total_otc_bought_units`, never `total_lamports_spent`, mechanically
/// lifting the lifetime average buy rate for every desk). The other four legs are drawn by the
/// keeper (`draw_creator_fee_leg`) for an off-chain swap, then attested back on-chain.
#[account]
#[derive(InitSpace)]
pub struct CreatorFeeState {
    pub authority: Pubkey,
    pub creator_fee_vault: Pubkey,
    pub clear_threshold_units: u64,
    /// Received but not yet split by `clear_creator_fees`.
    pub pending_otc_units: u64,
    pub burn_pending_otc: u64,
    pub lp_pending_otc: u64,
    pub stack_pending_otc: u64,
    pub ops_pending_otc: u64,
    pub total_received_otc: u64,
    pub total_desk_pot_otc: u64,
    pub total_burn_otc: u64,
    pub total_burn_hub: u64,
    pub total_lp_otc: u64,
    pub total_stack_otc: u64,
    pub total_stack_hub: u64,
    pub total_ops_otc: u64,
    pub total_ops_sol_lamports: u64,
    pub last_receive_tx: [u8; 64],
    /// Replay guard for `record_creator_fee_burn_result` (trust-attested like `record_burn`).
    pub last_burn_result_tx: [u8; 64],
    /// Replay guard for `record_creator_fee_stack`.
    pub last_stack_tx: [u8; 64],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TreasuryState {
    pub multisig: Pubkey,
    /// Program-signed custody PDA (`["vault"]`) for treasury-side token positions (LP, §A6.2).
    pub vault: Pubkey,
    pub desks_owned: u32,
    pub sweep_budget_cap_bp: u16,
    pub sweep_payback_cap_lamports: u64,
    pub exit_discount_bp: u16,
    pub exit_hub_leg_bp: u16,
    pub floor_staleness_bp: u16,
    pub hub_float_cap_bp: u16,
    pub total_exits: u32,
    pub total_sweeps: u32,
    /// §A5 5% leg, earmarked at every `finalize_epoch`; drawn down once the phase-2 LP adapter
    /// lands (mirrors `BurnState.burn_pending_lamports`'s keeper-draw pattern).
    pub lp_pending_lamports: u64,
    /// §A6.2 — one position per pair, HODL both legs.
    pub lp_hub_sol_active: bool,
    pub lp_hub_otc_active: bool,
    pub lp_hub_deposited: u64,
    pub lp_quote_deposited: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// §A4.1 `["otc_pay"]` — $OTC as an alternative step-fee currency. Created by the authority
/// after `initialize_config` (no `Config` migration); absent ⇒ the path does not exist.
#[account]
#[derive(InitSpace)]
pub struct OtcPayConfig {
    pub enabled: bool,
    /// Reference rate: $OTC base units per 1 SOL, refreshed by the authority (`set_otc_rate`).
    pub otc_per_sol: u64,
    pub rate_ts: i64,
    /// Premium over the SOL step-fee value (bp). Written from `OTC_PREMIUM_BP`, never updated.
    pub premium_bp: u16,
    /// Token account (mint = `Config.otc_mint`, owner = `["vault"]` PDA) that receives every $OTC
    /// fee. Program-custodied and reserved for the $OTC/$HUB POL leg (`build_lp(HubOtc)`).
    pub pol_account: Pubkey,
    pub total_otc_collected: u64,
    pub bump: u8,
}

/// §A7.1 `["tokenomics"]` — the supply allocation plan, on-chain so the dashboard and token-info
/// submissions read one source. Created by the authority after `initialize_config` (same
/// pattern as `OtcPayConfig`: no `Config` migration). Shares are bp of `max_supply_units`;
/// the airdrop share is derived from the desk count at snapshot, never typed in.
#[account]
#[derive(InitSpace)]
pub struct TokenomicsConfig {
    pub max_supply_units: u64,
    pub airdrop_per_desk_units: u64,
    /// Cumulative desk assets covered by the snapshot across every round so far (0 until the
    /// first `set_airdrop_root`; never decreases once claims have started — see `snapshot_round`).
    pub snapshot_desk_count: u32,
    pub snapshot_ts: i64,
    /// Number of times `set_airdrop_root` has published a changed root/desk_count. 0 = no
    /// snapshot yet; 1 = the genesis round; ≥2 = later rounds onboarding desks minted since —
    /// e.g. "distribute the first 1,800 desks now, run round 2 once the remaining ~700 mint."
    pub snapshot_round: u32,
    /// `snapshot_desk_count × airdrop_per_desk_units` — exact; `airdrop_bp` is the floored share.
    pub airdrop_units: u64,
    pub airdrop_bp: u16,
    pub treasury_lock_bp: u16,
    pub team_bp: u16,
    /// Public / OTC-launch share: whatever remains once airdrop + treasury lock + team are out.
    pub public_bp: u16,
    /// Merkle root over `keccak(AIRDROP_LEAF_TAG ‖ asset ‖ amount_le)`; zero until published.
    pub airdrop_root: [u8; 32],
    /// Vault-owned $HUB token account that funds claims (mint = `Config.hub_mint`).
    pub airdrop_vault: Pubkey,
    pub airdrop_claimed_units: u64,
    pub airdrop_claims: u32,
    pub airdrop_open: bool,
    /// Vault-owned $HUB token account holding the genesis 2% (`YIELD_RESERVE_BP`) floor. No
    /// instruction in this program ever debits it — recorded here for on-chain provenance /
    /// dashboard display, not as a spendable balance. The treasury multisig's own float ATA is
    /// the separate, ordinary account that accumulates additional $HUB on top over time
    /// (source C claims, capped by `TREASURY_HUB_FLOAT_CAP_BP`) — this vault only ever holds the
    /// fixed initial floor.
    pub treasury_lock_vault: Pubkey,
    /// `HUB_MAX_SUPPLY_UNITS × YIELD_RESERVE_BP / BPS_DENOMINATOR`, recorded once at
    /// `init_tokenomics` for auditability (compare against `treasury_lock_vault`'s live balance).
    pub treasury_lock_units: u64,
    /// Lifetime $HUB deposited into `treasury_lock_vault` by `fund_treasury_reward`, on top of
    /// the immutable `treasury_lock_units` floor — provenance only. `treasury_lock_vault`'s live
    /// balance always equals `treasury_lock_units + (reward_deposited_units -
    /// reward_distributed_units)`, since both the deposit (`TransferChecked` in) and every payout
    /// (`TransferChecked` out, capped per-round at `RewardRound.amount_units`) are enforced.
    pub reward_deposited_units: u64,
    /// Lifetime $HUB paid out of `treasury_lock_vault` to active desk holders via
    /// `distribute_treasury_reward`.
    pub reward_distributed_units: u64,
    /// Deposited via `fund_treasury_reward` but not yet snapshotted into a `RewardRound`.
    pub reward_pending_units: u64,
    /// Number of `RewardRound`s opened so far (next round's PDA index).
    pub reward_round_count: u32,
    pub bump: u8,
}

/// `["airdrop", asset]` — one claim per desk asset; existence is the double-claim guard.
#[account]
#[derive(InitSpace)]
pub struct AirdropClaim {
    pub asset: Pubkey,
    pub claimant: Pubkey,
    pub amount_units: u64,
    pub claimed_ts: i64,
    pub bump: u8,
}

/// `["reward_round", index]` — one `fund_treasury_reward` snapshot: `amount_units` split across
/// the active desks' Σw (`Config.total_weight_bp`) at the moment `open_reward_round` was called.
/// Each active desk may be paid its `amount_units × weight_bp(tier) / total_weight_bp` share
/// exactly once per round (see `RewardClaim`); `distributed_units` is capped at `amount_units`
/// on-chain, so the vault can never be over-drawn even if Σw drifts upward mid-round.
#[account]
#[derive(InitSpace)]
pub struct RewardRound {
    pub index: u32,
    pub amount_units: u64,
    pub total_weight_bp: u64,
    pub distributed_units: u64,
    pub claims: u32,
    pub opened_ts: i64,
    pub bump: u8,
}

/// `["reward_claim", round_index, asset]` — one payout per desk asset per reward round;
/// existence is the double-payout guard (mirrors `AirdropClaim`).
#[account]
#[derive(InitSpace)]
pub struct RewardClaim {
    pub round: u32,
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub amount_units: u64,
    pub claimed_ts: i64,
    pub bump: u8,
}

/// Fields `update_config` may touch (§B3 #9). Rate changes apply to future epochs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigField {
    OpsWallet,
    OtcProgram,
    OtcDeskPot,
    DeskCollection,
    HubMint,
    OtcMint,
    BurnPctBp,
    LpPctBp,
    OpsPctBp,
    LpEnabled,
    LpTargetSolLamports,
    LpPhase2OpenTs,
    MinPotThresholdLamports,
    Treasury,
    Authority,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum ConfigValue {
    Pubkey(Pubkey),
    U64(u64),
    U16(u16),
    Bool(bool),
    I64(i64),
}

impl Config {
    pub fn weight_bp(&self, tier: u8) -> Result<u64> {
        require!(
            (1..=TIER_COUNT as u8).contains(&tier),
            crate::errors::HubError::InvalidTier
        );
        Ok(self.tier_weights_bp[(tier - 1) as usize] as u64)
    }

    /// Flat SOL fee for an `activate_tier` / `upgrade_tier` call targeting `to` from `from`
    /// (`from = 0` means fresh activation). Does not scale with `to - from` — every call pays
    /// this once, whether it's a fresh T1 activation, a fresh T4 activation, or a T1→T4 upgrade.
    pub fn step_fee(&self, from: u8, to: u8) -> Result<u64> {
        require!(
            to > from && to as usize <= TIER_COUNT,
            crate::errors::HubError::InvalidTierStep
        );
        Ok(self.step_fee_lamports)
    }

    /// $HUB base units required to reach `tier` from scratch (cumulative table lookup).
    pub fn hub_cost(&self, tier: u8) -> Result<u64> {
        require!(
            (1..=TIER_COUNT as u8).contains(&tier),
            crate::errors::HubError::InvalidTier
        );
        Ok(self.tier_hub_cost_units[(tier - 1) as usize])
    }

    /// $HUB due for `from` → `to` (`from = 0` means fresh activation: the full cost of `to`).
    /// An upgrade only ever pays the difference — never the same $HUB twice.
    pub fn hub_cost_delta(&self, from: u8, to: u8) -> Result<u64> {
        require!(
            to > from && to as usize <= TIER_COUNT,
            crate::errors::HubError::InvalidTierStep
        );
        let to_cost = self.hub_cost(to)?;
        if from == 0 {
            return Ok(to_cost);
        }
        let from_cost = self.hub_cost(from)?;
        to_cost
            .checked_sub(from_cost)
            .ok_or_else(|| error!(crate::errors::HubError::MathOverflow))
    }
}

impl OtcPayConfig {
    /// $OTC due for `fee_lamports`: `⌈fee × otc_per_sol × premium_bp / (10⁹ × 10⁴)⌉`.
    /// Rounds up so the protocol never collects less than the premium value.
    pub fn otc_fee(&self, fee_lamports: u64) -> Result<u64> {
        use crate::constants::{BPS_DENOMINATOR, LAMPORTS_PER_SOL};
        let num = (fee_lamports as u128)
            .checked_mul(self.otc_per_sol as u128)
            .and_then(|v| v.checked_mul(self.premium_bp as u128))
            .ok_or_else(|| error!(crate::errors::HubError::MathOverflow))?;
        let den = (LAMPORTS_PER_SOL as u128) * (BPS_DENOMINATOR as u128);
        u64::try_from(num.div_ceil(den)).map_err(|_| error!(crate::errors::HubError::MathOverflow))
    }
}

impl TokenomicsConfig {
    /// Re-derives the split from the snapshot: airdrop = desks × per-desk (exact units, floored
    /// bp); public = 10⁴ − airdrop − treasury lock − team. Errors if the carve-outs exceed supply.
    pub fn apply_snapshot(&mut self, desk_count: u32) -> Result<()> {
        use crate::constants::BPS_DENOMINATOR;
        use crate::errors::HubError;
        let airdrop_units = (desk_count as u64)
            .checked_mul(self.airdrop_per_desk_units)
            .ok_or_else(|| error!(HubError::MathOverflow))?;
        // Exact-unit check first: the floored bp below would hide a sub-bp overshoot.
        let max = self.max_supply_units as u128;
        let fixed_bp = self.treasury_lock_bp as u128 + self.team_bp as u128;
        let fixed_units = max * fixed_bp / BPS_DENOMINATOR as u128;
        require!(
            airdrop_units as u128 + fixed_units <= max,
            HubError::AllocationExceedsSupply
        );
        let airdrop_bp = (airdrop_units as u128 * BPS_DENOMINATOR as u128 / max) as u16;
        let carved = airdrop_bp as u32 + fixed_bp as u32;
        self.snapshot_desk_count = desk_count;
        self.airdrop_units = airdrop_units;
        self.airdrop_bp = airdrop_bp;
        self.public_bp = (BPS_DENOMINATOR as u32 - carved) as u16;
        Ok(())
    }
}
