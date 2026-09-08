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
}

#[event]
pub struct BurnRecorded {
    pub hub_burned: u64,
    pub lamports_spent: u64,
    pub burn_pending_after: u64,
}

#[event]
pub struct LpBuilt {
    pub pair: u8,
    pub hub_amount: u64,
    pub quote_amount: u64,
}

/// Raydium CP-Swap `lock_cp_liquidity` executed right after `build_lp(HubOtc)` deposits —
/// the LP mint is burned in the same CPI and a permanent fee-claim NFT is minted to the
/// treasury vault PDA, so the position can never be withdrawn but keeps earning swap fees.
#[event]
pub struct LpLocked {
    pub pair: u8,
    pub hub_amount: u64,
    pub quote_amount: u64,
}

/// §A6.3 — treasury deposits its claimed launcher holder-leg $OTC into the creator-fee vault.
#[event]
pub struct CreatorFeeReceived {
    pub otc_received: u64,
    pub pending_after: u64,
    pub total_received: u64,
}

/// Pending balance split 80/5/5/5/5 into per-leg earmarks; the 80% desk-pot leg is injected
/// into `OtcPotState` in the same instruction (no swap needed — it's already $OTC).
#[event]
pub struct CreatorFeeCleared {
    pub cleared_otc: u64,
    pub desk_pot_otc: u64,
    pub burn_otc: u64,
    pub lp_otc: u64,
    pub stack_otc: u64,
    pub ops_otc: u64,
    pub otc_pot_total_bought_units_after: u64,
}

/// Keeper draws a leg's earmarked $OTC out of the vault to execute its off-chain swap.
#[event]
pub struct CreatorFeeLegDrawn {
    pub leg: u8,
    pub otc_amount: u64,
    pub pending_after: u64,
}

#[event]
pub struct CreatorFeeBurnRecorded {
    pub otc_spent: u64,
    pub hub_burned: u64,
    pub total_hub_burned_after: u64,
}

#[event]
pub struct CreatorFeeStackRecorded {
    pub otc_spent: u64,
    pub hub_amount: u64,
    pub total_stack_hub_after: u64,
}

#[event]
pub struct CreatorFeeOpsRecorded {
    pub otc_spent: u64,
    pub sol_amount: u64,
    pub total_ops_sol_after: u64,
}

/// §A7.1 — snapshot published (round 1) or extended (round ≥2 — desk_count grew to onboard
/// newly-minted desks) / claims toggled.
#[event]
pub struct AirdropRootSet {
    pub root: [u8; 32],
    pub desk_count: u32,
    pub round: u32,
    pub airdrop_units: u64,
    pub airdrop_bp: u16,
    pub public_bp: u16,
    pub open: bool,
    pub ts: i64,
}

/// User-initiated pull via `claim_airdrop`.
#[event]
pub struct AirdropClaimed {
    pub asset: Pubkey,
    pub claimant: Pubkey,
    pub amount_units: u64,
    pub total_claimed_units: u64,
    pub claims: u32,
}

/// Authority-initiated push via `distribute_airdrop` — same `AirdropClaim` PDA guard as
/// `AirdropClaimed`, so a desk can only ever appear in one of the two events, never both.
#[event]
pub struct AirdropDistributed {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub amount_units: u64,
    pub total_claimed_units: u64,
    pub claims: u32,
}

/// §A6.3 bridge — treasury deposits $HUB (swapped off-chain from the OTC launcher's
/// holders-in-stock reward leg) into `treasury_lock_vault`, earmarked for the next
/// `open_reward_round`.
#[event]
pub struct TreasuryRewardFunded {
    pub hub_amount: u64,
    pub pending_after: u64,
    pub total_deposited: u64,
}

/// Permissionless snapshot: `amount_units` split across the active desks' Σw at this moment.
#[event]
pub struct TreasuryRewardRoundOpened {
    pub round: u32,
    pub amount_units: u64,
    pub total_weight_bp: u64,
    pub ts: i64,
}

/// Authority-pushed payout of one active desk's tier-weighted share of an open reward round.
#[event]
pub struct TreasuryRewardDistributed {
    pub round: u32,
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub amount_units: u64,
    pub round_distributed_units: u64,
    pub claims: u32,
}

/// §A5.1 — treasury deposits converted source-B (13-stock) yield into the 4 HUB Pot buckets.
#[event]
pub struct HubPotFunded {
    pub otc_amount: u64,
    pub crclx_amount: u64,
    pub openai_amount: u64,
    pub anthropic_amount: u64,
    pub otc_pending_after: u64,
    pub crclx_pending_after: u64,
    pub openai_pending_after: u64,
    pub anthropic_pending_after: u64,
}

/// Permissionless snapshot: each bucket's pending balance split across the active desks' Σw.
#[event]
pub struct HubPotRoundOpened {
    pub round: u32,
    pub otc_units: u64,
    pub crclx_units: u64,
    pub openai_units: u64,
    pub anthropic_units: u64,
    pub total_weight_bp: u64,
    pub ts: i64,
}

/// Authority-pushed payout of one active desk's tier-weighted share of all 4 HUB Pot buckets.
#[event]
pub struct HubPotRewardDistributed {
    pub round: u32,
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub otc_units: u64,
    pub crclx_units: u64,
    pub openai_units: u64,
    pub anthropic_units: u64,
    pub claims: u32,
}

/// User-initiated pull via `claim_hub_pot_reward` — same `HubPotClaim` PDA guard as
/// `HubPotRewardDistributed`, so a desk can only ever appear in one of the two events per round.
#[event]
pub struct HubPotRewardClaimed {
    pub round: u32,
    pub asset: Pubkey,
    pub claimant: Pubkey,
    pub otc_units: u64,
    pub crclx_units: u64,
    pub openai_units: u64,
    pub anthropic_units: u64,
    pub claims: u32,
}
