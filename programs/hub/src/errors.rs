use anchor_lang::prelude::*;

#[error_code]
pub enum HubError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Basis-point value out of range")]
    BpsOutOfRange,
    #[msg("Config field is not whitelisted for update")]
    FieldNotUpdatable,
    #[msg("Tier out of range (1-4)")]
    InvalidTier,
    #[msg("Tier can only be upgraded by exactly one step from current")]
    InvalidTierStep,
    #[msg("Tier is already at maximum")]
    TierMaxed,
    #[msg("Tier is already active; use upgrade_tier")]
    TierAlreadyActive,
    #[msg("Claim pending yield before upgrading")]
    ClaimBeforeUpgrade,
    #[msg("No active stakers (Σw == 0); nothing to distribute")]
    NoActiveStakers,
    #[msg("Account is not a Metaplex Core AssetV1")]
    NotCoreAsset,
    #[msg("Wrong epoch account for the current epoch")]
    WrongEpoch,
    #[msg("Epoch index is not the current open epoch")]
    EpochNotCurrent,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("LP position for this pair already exists (one per pair)")]
    LpPositionExists,
    #[msg("Tier has been voided by an ownership change; re-activate")]
    TierVoided,
    #[msg("Caller does not own the desk asset")]
    NotDeskOwner,
    #[msg("Desk asset does not belong to the configured collection")]
    WrongCollection,
    #[msg("Open epoch inflow is below min_pot_threshold_lamports")]
    PotBelowThreshold,
    #[msg("Epoch already finalized")]
    EpochAlreadyFinalized,
    #[msg("Epoch is not finalized")]
    EpochNotFinalized,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Pot lamports below liability")]
    PotBelowLiability,
    #[msg("Inflow accounting invariant violated")]
    InvariantViolated,
    #[msg("LP building is disabled")]
    LpDisabled,
    #[msg("HUB/OTC LP is gated until phase-2 conditions hold")]
    LpPhase2Gated,
    #[msg("Floor moved more than the staleness guard since tx build")]
    FloorStale,
    #[msg("Treasury may not buy its own exit")]
    TreasurySelfDeal,
    #[msg("Burn-pending underflow")]
    BurnPendingUnderflow,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("$OTC payments are disabled")]
    OtcPaymentsDisabled,
    #[msg("$OTC reference rate is stale; authority must refresh it")]
    OtcRateStale,
    #[msg("Account is not an SPL token account for the expected mint/owner")]
    InvalidTokenAccount,
    #[msg("Token program does not match the configured mint")]
    WrongTokenProgram,
    #[msg("Airdrop + treasury lock + team allocations exceed the max supply")]
    AllocationExceedsSupply,
    #[msg("Airdrop claims are not open")]
    AirdropClosed,
    #[msg("Merkle proof does not match the published airdrop root")]
    AirdropInvalidProof,
    #[msg("Airdrop root cannot change once claims have been paid")]
    AirdropLocked,
    #[msg("Not implemented in this milestone")]
    NotImplemented,
    #[msg("OTC buy spend exceeds otc_pending_lamports")]
    OtcBuyExceedsPending,
    #[msg("No $OTC has been purchased yet; nothing claimable")]
    NoOtcPurchased,
    #[msg("Creator-fee pending balance is below the clearing threshold")]
    CreatorFeeBelowThreshold,
    #[msg("Creator-fee leg draw exceeds that leg's pending balance")]
    CreatorFeeLegExceedsPending,
    #[msg("build_lp requires AMM CPI accounts in remaining_accounts")]
    LpAccountsMissing,
    #[msg("Airdrop snapshot desk count exceeds the 2,500-desk cap")]
    AirdropCapExceeded,
    #[msg("No treasury reward pending; call fund_treasury_reward first")]
    NoRewardPending,
    #[msg("Reward round payout would exceed the round's snapshotted amount")]
    RewardRoundExceeded,
    #[msg("Desk is not an active tier holder")]
    DeskNotActive,
    #[msg("No HUB Pot bucket has a pending balance; call fund_hub_pot first")]
    NoHubPotPending,
    #[msg("HUB Pot round payout would exceed a bucket's snapshotted amount")]
    HubPotRoundExceeded,
    #[msg("Jupiter swap returned less than the required minimum output")]
    SlippageExceeded,
    #[msg("CPI target does not match the configured Jupiter program id")]
    WrongJupiterProgram,
    #[msg("Jupiter route requires accounts in remaining_accounts")]
    SwapAccountsMissing,
    #[msg("Treasury float vault has not been initialized")]
    TreasuryFloatNotInitialized,
    #[msg("lp_pending_hub_units is below the compounding dust floor")]
    LpCompoundBelowThreshold,
    #[msg("LpPair does not apply to this instruction (e.g. HubSol has no locked position)")]
    InvalidLpPair,
    #[msg("Fee-harvest CPI reported a lower balance than before the call")]
    HarvestBalanceUnderflow,
    #[msg("hop1_account_count exceeds the number of accounts supplied in remaining_accounts")]
    HopAccountSplitOutOfRange,
}
