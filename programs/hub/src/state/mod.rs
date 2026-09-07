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
    /// A round closes once the open epoch's inflow reaches this (no clock involved).
    pub min_pot_threshold_lamports: u64,
    pub burn_pct_bp: u16,
    pub ops_pct_bp: u16,
    pub consignment_enabled: bool,
    pub consignor_share_bp: u16,
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
    /// Lamports credited to stakers through `acc_per_weight` at finalize.
    pub distributed_lamports: u64,
    pub burn_pending_lamports: u64,
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

#[account]
#[derive(InitSpace)]
pub struct ConsignedDesk {
    pub asset_id: Pubkey,
    pub consignor: Pubkey,
    pub consigned_epoch: u64,
    pub active: bool,
    pub bump: u8,
}

/// Per-wallet consignor ledger (`["accrual", wallet]`): consignor-share credits still owed,
/// plus the lifetime total paid out by `claim_accrual`. Created by the treasury on the first
/// consigned inflow for that wallet.
#[account]
#[derive(InitSpace)]
pub struct StakerAccrual {
    pub wallet: Pubkey,
    pub owed_lamports: u64,
    pub total_claimed_lamports: u64,
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

#[account]
#[derive(InitSpace)]
pub struct TreasuryState {
    pub multisig: Pubkey,
    /// Program-signed custody PDA (`["vault"]`) that owns consigned desks.
    pub vault: Pubkey,
    pub desks_owned: u32,
    pub desks_consigned: u32,
    pub sweep_budget_cap_bp: u16,
    pub sweep_payback_cap_lamports: u64,
    pub exit_discount_bp: u16,
    pub exit_hub_leg_bp: u16,
    pub floor_staleness_bp: u16,
    pub hub_float_cap_bp: u16,
    pub total_exits: u32,
    pub total_sweeps: u32,
    /// §A6.2 — one position per pair, HODL both legs.
    pub lp_hub_sol_active: bool,
    pub lp_hub_otc_active: bool,
    pub lp_hub_deposited: u64,
    pub lp_quote_deposited: u64,
    pub bump: u8,
    pub vault_bump: u8,
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
    OpsPctBp,
    ConsignmentEnabled,
    ConsignorShareBp,
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

    /// Step fee for moving `from` → `to` (from = 0 means fresh activation).
    pub fn step_fee(&self, from: u8, to: u8) -> Result<u64> {
        require!(
            to > from && to as usize <= TIER_COUNT,
            crate::errors::HubError::InvalidTierStep
        );
        self.step_fee_lamports
            .checked_mul((to - from) as u64)
            .ok_or_else(|| error!(crate::errors::HubError::MathOverflow))
    }
}
