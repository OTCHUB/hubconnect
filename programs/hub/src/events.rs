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
    /// $HUB base units burned to reach `tier` (the full tier cost; `from = 0`).
    pub hub_burned_units: u64,
}

#[event]
pub struct TierUpgraded {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub from_tier: u8,
    pub to_tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
    /// $HUB base units burned for `from_tier → to_tier` (the cost difference).
    pub hub_burned_units: u64,
}

/// §A4.1 — step(s) paid in $OTC at the 2× premium; nothing enters the pot, the $OTC lands in the
/// POL reserve. `from_tier == 0` is a fresh activation. `hub_burned_units` is paid separately —
/// the $HUB tier cost is always burned, on both the SOL and $OTC fee paths.
#[event]
pub struct TierPaidOtc {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub from_tier: u8,
    pub to_tier: u8,
    pub epoch: u64,
    pub sol_equivalent_lamports: u64,
    pub otc_paid: u64,
    pub otc_per_sol: u64,
    pub premium_bp: u16,
    pub hub_burned_units: u64,
}

#[event]
pub struct OtcRateSet {
    pub otc_per_sol: u64,
    pub enabled: bool,
    pub ts: i64,
}

/// §B3 #8 — ownership changed since activation; no refund. Pending yield is forfeited to dust.
#[event]
pub struct TierVoided {
    pub asset: Pubkey,
    pub owner_at_activation: Pubkey,
    pub current_owner: Pubkey,
    pub tier: u8,
    pub epoch: u64,
    pub forfeited_lamports: u64,
}

/// One claim settles every round closed since the tier's stamp. `lamports` is the
/// lamport-equivalent entitlement settled; `otc_paid` is what actually left the vault, priced
/// at the pot's lifetime average buy rate at the moment of this claim.
#[event]
pub struct YieldClaimed {
    pub asset: Pubkey,
    pub claimer: Pubkey,
    pub epoch: u64,
    pub tier: u8,
    pub lamports: u64,
    pub otc_paid: u64,
    pub acc_per_weight: u128,
}

#[event]
pub struct EpochFinalized {
    pub index: u64,
    pub inflow_lamports: u64,
    pub distributed_lamports: u64,
    pub burn_pending_lamports: u64,
    pub lp_pending_lamports: u64,
    pub rolled_forward_lamports: u64,
    pub total_weight_bp: u64,
    pub per_weight_scaled: u128,
    pub acc_per_weight: u128,
}

/// Keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports` (mirrors
/// `BurnRecorded`). `otc_bought` is deposited into `otc_vault` in the same tx.
#[event]
pub struct OtcBuyRecorded {
    pub otc_bought: u64,
    pub lamports_spent: u64,
    pub otc_pending_after: u64,
    pub total_otc_bought_units: u64,
    pub total_lamports_spent: u64,
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
    pub lamports: u64,
}

#[event]
pub struct LpBuilt {
    pub pair: u8,
    pub hub_amount: u64,
    pub quote_amount: u64,
}

/// §A7.1 — snapshot published (or re-published before any claim) / claims toggled.
#[event]
pub struct AirdropRootSet {
    pub root: [u8; 32],
    pub desk_count: u32,
    pub airdrop_units: u64,
    pub airdrop_bp: u16,
    pub public_bp: u16,
    pub open: bool,
    pub ts: i64,
}

#[event]
pub struct AirdropClaimed {
    pub asset: Pubkey,
    pub claimant: Pubkey,
    pub amount_units: u64,
    pub total_claimed_units: u64,
    pub claims: u32,
}
