//! Pot lamport plumbing + the §B3 program-level invariants asserted after every mutation.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::*;
use crate::errors::HubError;
use crate::state::*;

pub fn bps_of(amount: u64, bp: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bp as u128)
        .ok_or_else(|| error!(HubError::MathOverflow))?
        / BPS_DENOMINATOR as u128;
    u64::try_from(v).map_err(|_| error!(HubError::MathOverflow))
}

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| error!(HubError::MathOverflow))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b)
        .ok_or_else(|| error!(HubError::MathOverflow))
}

/// Signer → any destination (pot / ops wallet).
pub fn transfer_from_signer<'info>(
    system_program: &Program<'info, System>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.clone(),
                to: to.clone(),
            },
        ),
        lamports,
    )
}

/// Pot (system-owned PDA, no data) → destination, signed with `["pot", bump]`.
pub fn pay_from_pot<'info>(
    system_program: &Program<'info, System>,
    pot: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    pot_bump: u8,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[SEED_POT, &[pot_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: pot.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        lamports,
    )
}

/// Record `lamports` as inflow of the open epoch and as pot liability.
pub fn book_inflow(config: &mut Config, epoch: &mut Epoch, lamports: u64) -> Result<()> {
    require!(epoch.index == config.current_epoch, HubError::WrongEpoch);
    require!(!epoch.finalized, HubError::EpochAlreadyFinalized);
    epoch.inflow_lamports = add(epoch.inflow_lamports, lamports)?;
    config.pot_liability_lamports = add(config.pot_liability_lamports, lamports)?;
    Ok(())
}

/// `pot lamports ≥ liability` — the rent-exempt floor funded at init is excluded.
pub fn assert_pot_solvent(config: &Config, pot: &AccountInfo) -> Result<()> {
    let floor = Rent::get()?.minimum_balance(0);
    let free = pot.lamports().saturating_sub(floor);
    require!(
        free >= config.pot_liability_lamports,
        HubError::PotBelowLiability
    );
    Ok(())
}

/// `inflow == distributed + burn_pending + rolled_forward` for a finalized epoch.
pub fn assert_epoch_balanced(e: &Epoch) -> Result<()> {
    let rhs = add(
        add(e.distributed_lamports, e.burn_pending_lamports)?,
        e.rolled_forward_lamports,
    )?;
    require!(e.inflow_lamports == rhs, HubError::InvariantViolated);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config {
            authority: Pubkey::default(),
            pot: Pubkey::default(),
            ops_wallet: Pubkey::default(),
            treasury: Pubkey::default(),
            otc_program: Pubkey::default(),
            otc_desk_pot: Pubkey::default(),
            desk_collection: Pubkey::default(),
            hub_mint: Pubkey::default(),
            otc_mint: Pubkey::default(),
            tier_weights_bp: TIER_WEIGHTS_BP,
            step_fee_lamports: STEP_FEE_LAMPORTS,
            epoch_hours: EPOCH_HOURS,
            epoch_duration_secs: EPOCH_DURATION_SECS,
            burn_pct_bp: BURN_PCT_BP,
            ops_pct_bp: OPS_PCT_BP,
            consignment_enabled: true,
            consignor_share_bp: 0,
            lp_enabled: false,
            lp_target_sol_lamports: 0,
            lp_phase2_open_ts: 0,
            paused: false,
            current_epoch: 0,
            genesis_ts: 0,
            total_weight_bp: 0,
            pot_liability_lamports: 0,
            bump: 0,
            pot_bump: 0,
        }
    }

    #[test]
    fn step_fees_match_a4_table() {
        let c = cfg();
        assert_eq!(c.step_fee(0, 1).unwrap(), 500_000_000);
        assert_eq!(c.step_fee(1, 4).unwrap(), 1_500_000_000);
        assert_eq!(c.step_fee(2, 3).unwrap(), 500_000_000);
        assert!(c.step_fee(2, 2).is_err());
        assert!(c.step_fee(3, 5).is_err());
    }

    #[test]
    fn activation_split_is_90_10() {
        let fee = 500_000_000u64;
        let ops = bps_of(fee, OPS_PCT_BP).unwrap();
        assert_eq!(ops, 50_000_000);
        assert_eq!(fee - ops, 450_000_000);
    }

    #[test]
    fn weights_and_void_semantics() {
        let c = cfg();
        assert_eq!(c.weight_bp(1).unwrap(), 10_000);
        assert_eq!(c.weight_bp(4).unwrap(), 20_000);
        assert!(c.weight_bp(0).is_err());
        assert!(c.weight_bp(5).is_err());
    }

    /// Four desks T1..T4, 10 SOL inflow: 1 SOL burn, 9 SOL split 1.0/1.25/1.6/2.0; last claimer
    /// receives the remainder so Σ payouts == distributed exactly.
    #[test]
    fn epoch_distribution_no_rounding_loss() {
        let inflow = 10_000_000_000u64;
        let burn = bps_of(inflow, BURN_PCT_BP).unwrap();
        let distributed = inflow - burn;
        assert_eq!(burn, 1_000_000_000);
        let total_w: u64 = TIER_WEIGHTS_BP.iter().map(|w| *w as u64).sum();
        let mut claimed = 0u64;
        let mut claimed_w = 0u64;
        let mut payouts = vec![];
        for w in TIER_WEIGHTS_BP {
            let w = w as u64;
            let remaining = total_w - claimed_w;
            let owed = if w == remaining {
                distributed - claimed
            } else {
                ((distributed as u128 * w as u128) / total_w as u128) as u64
            };
            claimed += owed;
            claimed_w += w;
            payouts.push(owed);
        }
        assert_eq!(claimed, distributed);
        assert_eq!(payouts[0], 9_000_000_000 * 10_000 / 58_500);
        assert!(payouts[3] > payouts[2] && payouts[2] > payouts[1] && payouts[1] > payouts[0]);
    }

    #[test]
    fn epoch_balance_invariant() {
        let mut e = Epoch {
            index: 0,
            start_ts: 0,
            end_ts: 0,
            inflow_lamports: 1_000,
            distributed_lamports: 900,
            burned_lamports: 0,
            burn_pending_lamports: 100,
            rolled_forward_lamports: 0,
            total_weight_bp: 1,
            claimed_lamports: 0,
            claimed_weight_bp: 0,
            finalized: true,
            bump: 0,
        };
        assert!(assert_epoch_balanced(&e).is_ok());
        e.rolled_forward_lamports = 1;
        assert!(assert_epoch_balanced(&e).is_err());
    }
}
