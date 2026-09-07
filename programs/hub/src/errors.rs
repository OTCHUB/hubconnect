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
    #[msg("Tier has been voided by an ownership change; re-activate")]
    TierVoided,
    #[msg("Caller does not own the desk asset")]
    NotDeskOwner,
    #[msg("Desk asset does not belong to the configured collection")]
    WrongCollection,
    #[msg("Epoch has not ended yet")]
    EpochNotEnded,
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
    #[msg("Not implemented in this milestone")]
    NotImplemented,
}
