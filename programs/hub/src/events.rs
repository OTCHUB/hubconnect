//! Emitted for keepers, the yield tracker, and audit trails.

use anchor_lang::prelude::*;

#[event]
pub struct TierActivated {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
    pub to_pot: u64,
    pub to_ops: u64,
}

#[event]
pub struct TierUpgraded {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub from_tier: u8,
    pub to_tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
}

/// §B3 #8 — ownership changed since activation; no refund.
#[event]
pub struct TierVoided {
    pub asset: Pubkey,
    pub owner_at_activation: Pubkey,
    pub current_owner: Pubkey,
    pub tier: u8,
    pub epoch: u64,
}

#[event]
pub struct YieldClaimed {
    pub asset: Pubkey,
    pub claimer: Pubkey,
    pub epoch: u64,
    pub tier: u8,
    pub lamports: u64,
}

#[event]
pub struct EpochFinalized {
    pub index: u64,
    pub inflow_lamports: u64,
    pub distributed_lamports: u64,
    pub burn_pending_lamports: u64,
    pub rolled_forward_lamports: u64,
    pub total_weight_bp: u64,
}

#[event]
pub struct InflowRegistered {
    pub epoch: u64,
    pub source: u8,
    pub lamports: u64,
    pub consignor_share: u64,
}

#[event]
pub struct BurnRecorded {
    pub hub_burned: u64,
    pub lamports_spent: u64,
    pub burn_pending_after: u64,
}

#[event]
pub struct DeskConsigned {
    pub asset: Pubkey,
    pub consignor: Pubkey,
    pub epoch: u64,
}

#[event]
pub struct DeskUnconsigned {
    pub asset: Pubkey,
    pub consignor: Pubkey,
    pub epoch: u64,
}

#[event]
pub struct AccrualClaimed {
    pub wallet: Pubkey,
    pub epoch: u64,
    pub lamports: u64,
}

#[event]
pub struct LpBuilt {
    pub pair: u8,
    pub hub_amount: u64,
    pub quote_amount: u64,
}
