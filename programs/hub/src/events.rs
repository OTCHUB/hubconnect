//! Emitted for keepers, the yield tracker, and audit trails.

use anchor_lang::prelude::*;

use crate::constants::TIER_COUNT;

#[event]
pub struct TierActivated {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
    pub to_pot: u64,
    pub to_ops: u64,
    /// $HUB base units burned outright — `tier_cost_burn_bp` of the full tier cost (`from = 0`).
    pub hub_burned_units: u64,
    /// $HUB base units deposited into the active-desk reward pool — the remainder of the tier
    /// cost after `hub_burned_units` (see `Config.tier_cost_burn_bp`).
    pub hub_reward_units: u64,
}

#[event]
pub struct TierUpgraded {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub from_tier: u8,
    pub to_tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
    /// $HUB base units burned outright — `tier_cost_burn_bp` of the `from_tier → to_tier` cost
    /// difference.
    pub hub_burned_units: u64,
    /// $HUB base units deposited into the active-desk reward pool — the remainder of the cost
    /// difference after `hub_burned_units`.
    pub hub_reward_units: u64,
}

/// §A4.1 (revised) — step(s) paid in $OTC: the target tier's ascending SOL fee (T1 0.2 / T2 0.3 /
/// T3 0.4 / T4 0.5 SOL; 90% pot / 10% ops, same as the SOL path — `fee_lamports`/`to_pot`/
/// `to_ops`) plus the $OTC 2× premium, split into
/// a swap-burn leg (real on-chain Jupiter OTC→$HUB, burned in full — this *is* the tier's $HUB
/// cost burn, no separate direct debit from the payer's own $HUB wallet) and an equal-sized
/// desk-pot leg (raises `OtcPotState`'s lifetime average buy rate). `from_tier == 0` is a fresh
/// activation.
#[event]
pub struct TierPaidOtc {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub from_tier: u8,
    pub to_tier: u8,
    pub epoch: u64,
    pub fee_lamports: u64,
    pub to_pot: u64,
    pub to_ops: u64,
    /// $OTC input to the Jupiter swap-burn leg.
    pub otc_swap_amount: u64,
    /// $HUB received from the swap (≥ `hub_cost_delta`), `tier_cost_burn_bp` of which is burned.
    pub hub_burned_units: u64,
    /// Remainder of the received $HUB after `hub_burned_units`, deposited into the active-desk
    /// reward pool (see `Config.tier_cost_burn_bp`).
    pub hub_reward_units: u64,
    /// Equal to `otc_swap_amount`, injected into `OtcPotState.otc_vault` (no swap).
    pub to_otc_pot: u64,
    /// Total $OTC charged (`otc_swap_amount + to_otc_pot`), i.e. the "2× premium".
    pub otc_paid_total: u64,
}

/// Authority toggles the $OTC payment path on/off (`init_otc_payments` starts it disabled).
#[event]
pub struct OtcPaymentsEnabledSet {
    pub enabled: bool,
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
    /// SOL input to this epoch's burn leg — swapped and burned synchronously, not left pending.
    pub burn_pending_lamports: u64,
    /// SOL input to this epoch's LP-build leg — swapped to $HUB and earmarked, not left pending.
    pub lp_pending_lamports: u64,
    /// SOL input to this epoch's treasury-float leg — swapped to $HUB and deposited/burned.
    pub treasury_float_lamports: u64,
    pub rolled_forward_lamports: u64,
    pub total_weight_bp: u64,
    pub per_weight_scaled: u128,
    pub acc_per_weight: u128,
}

/// The synchronous two-hop Jupiter WSOL→USDC→$HUB CPI executed inside `finalize_epoch` for the
/// combined burn/LP/treasury-float legs (10% of inflow). `usdc_received` is hop1's (WSOL→USDC)
/// output; `hub_received` is hop2's (USDC→$HUB) output, which splits 50/25/25 into
/// `hub_burned`/`hub_lp_earmarked`/`hub_float_requested`; `hub_float_deposited` may be less than
/// `hub_float_requested` if the cap was hit, with the remainder folded into `hub_burned`.
/// `price_updated` is true when `sol_swapped_lamports` cleared `PRICE_UPDATE_MIN_SOL_LAMPORTS`
/// and the realized USDC/HUB rate was used to refresh `tier_hub_cost_units_after` (clamped by
/// `clamp_tier_cost`); when false, `tier_hub_cost_units_after` is unchanged from before this call.
#[event]
pub struct EpochSolSwapped {
    pub epoch: u64,
    pub sol_swapped_lamports: u64,
    pub usdc_received: u64,
    pub hub_received: u64,
    pub hub_burned: u64,
    pub hub_lp_earmarked: u64,
    pub hub_float_requested: u64,
    pub hub_float_deposited: u64,
    pub treasury_float_units_after: u64,
    pub price_updated: bool,
    pub tier_hub_cost_units_after: [u64; TIER_COUNT],
    pub last_price_update_ts: i64,
}

/// Authority/treasury records the vault-owned $HUB scratch, WSOL scratch, USDC scratch, and
/// treasury-float ATAs used by the synchronous Jupiter legs (one-time, post-init — mirrors
/// `init_otc_pot`).
#[event]
pub struct TreasuryFloatInitialized {
    pub vault_wsol: Pubkey,
    pub vault_usdc: Pubkey,
    pub vault_hub: Pubkey,
    pub treasury_float_vault: Pubkey,
}

/// Treasury multisig retunes the experimental float cap.
#[event]
pub struct TreasuryFloatCapUpdated {
    pub hub_float_cap_bp: u16,
}

/// Treasury multisig repoints `vault_wsol`/`vault_usdc` at new vault-PDA-owned token accounts
/// (migration to canonical ATAs — Jupiter's `/swap/v2/build` always debits the canonical ATA of
/// (taker, inputMint), so `finalize_epoch`'s hop1 source accounts must be ATAs, not arbitrary
/// plain spl-token accounts). One-time-per-call, replaces the values `init_treasury_float` set.
#[event]
pub struct TreasuryVaultsRepointed {
    pub old_vault_wsol: Pubkey,
    pub new_vault_wsol: Pubkey,
    pub old_vault_usdc: Pubkey,
    pub new_vault_usdc: Pubkey,
}

/// Keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports`.
/// `otc_bought` is deposited into `otc_vault` in the same tx.
#[event]
pub struct OtcBuyRecorded {
    pub otc_bought: u64,
    pub lamports_spent: u64,
    pub otc_pending_after: u64,
    pub total_otc_bought_units: u64,
    pub total_lamports_spent: u64,
}

/// `Config.authority` rotated `OtcPotState.authority` (`set_otc_pot_keeper`) — e.g. moving the
/// pot from the master deployer key to a dedicated `otc-buy` keeper hot wallet.
#[event]
pub struct OtcPotKeeperUpdated {
    pub old_keeper: Pubkey,
    pub new_keeper: Pubkey,
}

/// `Config.authority` repointed `OtcPotState.otc_vault` (`set_otc_vault`) — the recovery path
/// when the vault's mint (fixed at `init_otc_pot` time) drifts from a later `Config.otc_mint`.
#[event]
pub struct OtcVaultUpdated {
    pub old_vault: Pubkey,
    pub new_vault: Pubkey,
}

/// `Config.authority` retuned one tier's `TierFeeConfig.tier_step_fee_lamports` entry
/// (`set_tier_step_fee`).
#[event]
pub struct TierStepFeeUpdated {
    pub tier: u8,
    pub old_lamports: u64,
    pub new_lamports: u64,
}

/// `lamports` is the gross amount the treasury moved; `to_ops` (the `Config.protocol_fee_bp`
/// skim, taken before this became pot inflow) already left for `ops_wallet` — only
/// `lamports - to_ops` was booked as epoch inflow.
#[event]
pub struct InflowRegistered {
    pub epoch: u64,
    pub source: u8,
    pub lamports: u64,
    pub to_ops: u64,
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

/// `compound_lp_otc` / `compound_lp_basket`'s permissionless call — self-contained summary,
/// mirrored by `LpBuilt`/`LpLocked` for the same deposit. Uncapped (§A5 revenue-model
/// extension): `hub_deposited` always equals `hub_pending_before` — nothing is ever burned, the
/// position only ever grows.
#[event]
pub struct LpCompounded {
    pub pair: u8,
    pub hub_pending_before: u64,
    pub hub_deposited: u64,
    pub quote_deposited: u64,
}

/// `harvest_lp_fees`'s permissionless call — `hub_harvested` feeds back into `pair`'s own
/// pending compounding earmark; `quote_harvested` is credited straight into `HubPotConfig`'s
/// matching bucket (yield flowing back to desk-holders).
#[event]
pub struct LpFeesHarvested {
    pub pair: u8,
    pub hub_harvested: u64,
    pub quote_harvested: u64,
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
    pub nvdax_amount: u64,
    pub spcxx_amount: u64,
    pub otc_pending_after: u64,
    pub crclx_pending_after: u64,
    pub nvdax_pending_after: u64,
    pub spcxx_pending_after: u64,
}

/// §A5 revenue-model extension — `Config.protocol_fee_bp` skimmed per-mint into `ops_wallet`'s
/// ATAs in the same `fund_hub_pot` call the `HubPotFunded` above reports (that event's amounts
/// are already net of this skim).
#[event]
pub struct HubPotProtocolFeeSkimmed {
    pub otc_to_ops: u64,
    pub crclx_to_ops: u64,
    pub nvdax_to_ops: u64,
    pub spcxx_to_ops: u64,
}

/// Permissionless snapshot: each bucket's pending balance split across the active desks' Σw.
#[event]
pub struct HubPotRoundOpened {
    pub round: u32,
    pub otc_units: u64,
    pub crclx_units: u64,
    pub nvdax_units: u64,
    pub spcxx_units: u64,
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
    pub nvdax_units: u64,
    pub spcxx_units: u64,
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
    pub nvdax_units: u64,
    pub spcxx_units: u64,
    pub claims: u32,
}

/// Permissionless — `recognize_hub_pot_inflow` reconciled a bucket vault's live balance against
/// `HubPotConfig`/`HubPotInflowState`'s recognized history and found genuinely new inflow (e.g.
/// the OTC Desks launcher's automatic pro-rata holder payout landing straight in the vault).
/// `*_recognized` is already net of the `*_to_ops` skim reported alongside it (mirrors
/// `HubPotFunded`/`HubPotProtocolFeeSkimmed`'s pairing for the manual `fund_hub_pot` path).
#[event]
pub struct HubPotInflowRecognized {
    pub otc_recognized: u64,
    pub crclx_recognized: u64,
    pub nvdax_recognized: u64,
    pub spcxx_recognized: u64,
    pub otc_to_ops: u64,
    pub crclx_to_ops: u64,
    pub nvdax_to_ops: u64,
    pub spcxx_to_ops: u64,
    pub otc_pending_after: u64,
    pub crclx_pending_after: u64,
    pub nvdax_pending_after: u64,
    pub spcxx_pending_after: u64,
}

/// Governance-only bucket mint swap (`update_hub_pot_mint`) — e.g. rotating a synthetic
/// pre-IPO token out for a directly-backed xStock RWA once its deviation risk is reassessed.
/// `swept_to_ops` is any dust the old vault held at swap time, sent to `Config.ops_wallet`'s ATA
/// for `old_mint` so nothing is stranded once `hub_pot` stops pointing at `old_vault`.
#[event]
pub struct HubPotMintUpdated {
    pub bucket: u8,
    pub old_mint: Pubkey,
    pub new_mint: Pubkey,
    pub old_vault: Pubkey,
    pub new_vault: Pubkey,
    pub swept_to_ops: u64,
}
