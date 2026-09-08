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
    #[msg("Desk is already consigned")]
    AlreadyConsigned,
    #[msg("Burn spend exceeds burn-pending")]
    BurnExceedsPending,
    #[msg("Accrual has nothing owed")]
    AccrualEmpty,
    #[msg("LP position for this pair already exists (one per pair)")]
    LpPositionExists,
    #[msg("Consigned desks are not eligible for treasury exits")]
    ConsignedNotExitable,
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
    #[msg("Consignment is disabled")]
    ConsignmentDisabled,
    #[msg("Desk is consigned and cannot be sold or transferred by treasury")]
    DeskConsigned,
    #[msg("Consignment is not active")]
    ConsignmentInactive,
    #[msg("Cannot unconsign until the current epoch is finalized")]
    UnconsignBeforeFinalize,
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
}
