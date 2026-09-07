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
    pub epoch_hours: u16,
    /// Effective epoch length; defaults to `epoch_hours * 3600`, shortened on test clusters.
    pub epoch_duration_secs: u64,
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
    pub bump: u8,
    pub pot_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub index: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub inflow_lamports: u64,
    /// 90% allotment reserved for stakers at finalize.
    pub distributed_lamports: u64,
    pub burned_lamports: u64,
    pub burn_pending_lamports: u64,
    /// Allotment carried into the next epoch when Σw == 0 (no eligible stakers).
    pub rolled_forward_lamports: u64,
    /// Σw of non-voided DeskTiers at finalize (bp-weighted).
    pub total_weight_bp: u64,
    /// Claim progress; the last claimer receives `distributed - claimed` (no rounding loss).
    pub claimed_lamports: u64,
    pub claimed_weight_bp: u64,
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
    /// Claims are sequential: the next epoch index this tier may claim.
    pub next_claim_epoch: u64,
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

#[account]
#[derive(InitSpace)]
pub struct StakerAccrual {
    pub wallet: Pubkey,
    pub epoch_index: u64,
    pub owed_lamports: u64,
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
    EpochDurationSecs,
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
