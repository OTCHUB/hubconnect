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

/// Split one round across Σw: `(per_weight_scaled, credited_lamports, ceil_slack_scaled)`.
/// `credited = ⌈per_w × Σw / ACC_SCALE⌉ ≤ distributable`; the slack (< ACC_SCALE) is the part of
/// `credited` the accumulator does not hand out, so it goes to dust and stays zero-sum.
pub fn round_credit(distributable: u64, total_weight_bp: u64) -> Result<(u128, u64, u128)> {
    require!(total_weight_bp > 0, HubError::NoActiveStakers);
    let scaled = (distributable as u128)
        .checked_mul(ACC_SCALE)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let per_w = scaled / total_weight_bp as u128;
    let handed = per_w
        .checked_mul(total_weight_bp as u128)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let credited = handed.div_ceil(ACC_SCALE);
    let slack = credited * ACC_SCALE - handed;
    let credited = u64::try_from(credited).map_err(|_| error!(HubError::MathOverflow))?;
    Ok((per_w, credited, slack))
}

/// Pending yield of a tier with weight `w`: `(owed_lamports, sub_lamport_frac_scaled)`.
pub fn pending_yield(acc: u128, stamp: u128, w: u64) -> Result<(u64, u128)> {
    let delta = acc
        .checked_sub(stamp)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let exact = delta
        .checked_mul(w as u128)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let owed = u64::try_from(exact / ACC_SCALE).map_err(|_| error!(HubError::MathOverflow))?;
    Ok((owed, exact % ACC_SCALE))
}

pub fn add_dust(config: &mut Config, scaled: u128) -> Result<()> {
    config.dust_scaled = config
        .dust_scaled
        .checked_add(scaled)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    Ok(())
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

/// `inflow == distributed + burn_pending + lp_pending + treasury_float + rolled_forward` for a
/// finalized epoch (§A5 4-way split: the three swap legs are SOL *inputs* to `finalize_epoch`'s
/// synchronous Jupiter CPI, already spent by the time this runs — this invariant only checks
/// that inflow accounting itself is zero-sum, independent of the swap's outcome).
pub fn assert_epoch_balanced(e: &Epoch) -> Result<()> {
    let rhs = add(
        add(
            add(
                add(e.distributed_lamports, e.burn_pending_lamports)?,
                e.lp_pending_lamports,
            )?,
            e.treasury_float_lamports,
        )?,
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
            tier_hub_cost_units: TIER_HUB_COST_UNITS,
            min_pot_threshold_lamports: MIN_POT_THRESHOLD_LAMPORTS,
            burn_pct_bp: BURN_PCT_BP,
            lp_pct_bp: LP_PCT_BP,
            treasury_float_pct_bp: TREASURY_FLOAT_PCT_BP,
            ops_pct_bp: OPS_PCT_BP,
            lp_enabled: false,
            lp_target_sol_lamports: 0,
            lp_phase2_open_ts: 0,
            paused: false,
            current_epoch: 0,
            genesis_ts: 0,
            total_weight_bp: 0,
            pot_liability_lamports: 0,
            acc_per_weight: 0,
            dust_scaled: 0,
            bump: 0,
            pot_bump: 0,
        }
    }

    /// Flat fee: every activate/upgrade call pays 0.5 SOL once, independent of the step size —
    /// a fresh T1 activation, a fresh T4 activation, and a T1→T4 upgrade all cost the same.
    #[test]
    fn step_fees_are_flat_regardless_of_step_size() {
        let c = cfg();
        assert_eq!(c.step_fee(0, 1).unwrap(), 500_000_000);
        assert_eq!(c.step_fee(0, 4).unwrap(), 500_000_000);
        assert_eq!(c.step_fee(1, 4).unwrap(), 500_000_000);
        assert_eq!(c.step_fee(2, 3).unwrap(), 500_000_000);
        assert!(c.step_fee(2, 2).is_err());
        assert!(c.step_fee(3, 5).is_err());
    }

    /// $HUB tier cost table (§A4): fresh activation burns the full cost of the target tier; an
    /// upgrade only ever burns the difference from the tier already held.
    #[test]
    fn hub_costs_match_a4_table() {
        let c = cfg();
        assert_eq!(c.hub_cost(1).unwrap(), 100_000 * HUB_UNIT);
        assert_eq!(c.hub_cost(4).unwrap(), 200_000 * HUB_UNIT);
        assert_eq!(c.hub_cost_delta(0, 1).unwrap(), 100_000 * HUB_UNIT);
        assert_eq!(c.hub_cost_delta(0, 4).unwrap(), 200_000 * HUB_UNIT);
        assert_eq!(c.hub_cost_delta(1, 2).unwrap(), 25_000 * HUB_UNIT);
        assert_eq!(c.hub_cost_delta(1, 4).unwrap(), 100_000 * HUB_UNIT);
        assert!(c.hub_cost_delta(2, 2).is_err());
        assert!(c.hub_cost(0).is_err());
        assert!(c.hub_cost(5).is_err());
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

    /// Four desks T1..T4, 10 SOL round: 0.5 SOL burn, 0.25 SOL LP, 0.25 SOL treasury-float
    /// (all three swapped SOL→$HUB via the synchronous Jupiter CPI), 9 SOL (the $OTC leg)
    /// credited through the accumulator in 1.0/1.25/1.6/2.0 proportion. Σ payouts + dust ==
    /// credited × ACC_SCALE exactly — nothing is stranded, nothing is over-paid.
    #[test]
    fn round_distribution_is_5_2_5_2_5_90() {
        let inflow = 10_000_000_000u64;
        let burn = bps_of(inflow, BURN_PCT_BP).unwrap();
        let lp = bps_of(inflow, LP_PCT_BP).unwrap();
        let float = bps_of(inflow, TREASURY_FLOAT_PCT_BP).unwrap();
        assert_eq!(burn, 500_000_000);
        assert_eq!(lp, 250_000_000);
        assert_eq!(float, 250_000_000);
        let distributable = inflow - burn - lp - float;
        assert_eq!(distributable, 9_000_000_000);
        let total_w: u64 = TIER_WEIGHTS_BP.iter().map(|w| *w as u64).sum();
        let (per_w, credited, slack) = round_credit(distributable, total_w).unwrap();
        assert!(credited <= distributable && distributable - credited <= 1);
        assert!(slack < ACC_SCALE);

        let mut paid = 0u64;
        let mut dust = slack;
        let mut payouts = vec![];
        for w in TIER_WEIGHTS_BP {
            let (owed, frac) = pending_yield(per_w, 0, w as u64).unwrap();
            paid += owed;
            dust += frac;
            payouts.push(owed);
        }
        assert_eq!(
            paid as u128 * ACC_SCALE + dust,
            credited as u128 * ACC_SCALE
        );
        assert_eq!(payouts[0], 9_000_000_000 * 10_000 / 58_500);
        assert!(payouts[3] > payouts[2] && payouts[2] > payouts[1] && payouts[1] > payouts[0]);
        // Dust carries whole lamports back into the next round.
        assert!(dust / ACC_SCALE + paid as u128 == credited as u128);
    }

    /// Rounds accumulate: a tier that skips claiming still receives every round in one claim.
    #[test]
    fn one_claim_settles_many_rounds() {
        let total_w = 58_500u64;
        let mut acc = 0u128;
        let mut expected = 0u128;
        for dist in [90_000_000u64, 135_000_000, 45_000_000] {
            let (per_w, _, _) = round_credit(dist, total_w).unwrap();
            acc += per_w;
            expected += per_w * 20_000;
        }
        let (owed, frac) = pending_yield(acc, 0, 20_000).unwrap();
        assert_eq!(owed as u128 * ACC_SCALE + frac, expected);
        assert!(pending_yield(0, acc, 20_000).is_err()); // stamp ahead of counter is impossible
    }

    #[test]
    fn epoch_balance_invariant() {
        let mut e = Epoch {
            index: 0,
            start_ts: 0,
            finalized_ts: 0,
            inflow_lamports: 1_000,
            distributed_lamports: 800,
            burn_pending_lamports: 100,
            lp_pending_lamports: 50,
            treasury_float_lamports: 50,
            rolled_forward_lamports: 0,
            total_weight_bp: 1,
            per_weight_scaled: 0,
            acc_per_weight_after: 0,
            finalized: true,
            bump: 0,
        };
        assert!(assert_epoch_balanced(&e).is_ok());
        e.rolled_forward_lamports = 1;
        assert!(assert_epoch_balanced(&e).is_err());
    }
}
