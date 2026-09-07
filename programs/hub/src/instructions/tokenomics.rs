//! §A7.1 — supply allocation plan + snapshot airdrop.
//!
//! `init_tokenomics` (authority) records the plan once: max supply, per-desk airdrop size,
//! treasury lock and team shares, and the vault-owned $HUB account that funds claims.
//! `set_airdrop_root` publishes the desk snapshot as a Merkle root and derives the airdrop /
//! public split from the desk count. `claim_airdrop` pays the *current* owner of a desk that
//! was in the snapshot: the leaf commits to the asset, not to a wallet, so a desk that changes
//! hands after the snapshot carries its allocation with it (one claim per asset, ever).

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::*;
use crate::errors::HubError;
use crate::events::*;
use crate::instructions::mpl_core::require_desk;
use crate::instructions::otc_pay::{require_token_account, transfer_checked};
use crate::state::*;

/// `sha256(AIRDROP_LEAF_TAG ‖ asset ‖ amount_le)` — 54-byte preimage, so a leaf can never
/// collide with a 64-byte interior node. sha256 is the `sol_sha256` syscall on-chain.
pub fn airdrop_leaf(asset: &Pubkey, amount_units: u64) -> [u8; 32] {
    hashv(&[
        AIRDROP_LEAF_TAG,
        asset.as_ref(),
        &amount_units.to_le_bytes(),
    ])
    .to_bytes()
}

/// Sorted-pair Merkle verification (order-independent siblings). The SDK builds the tree the
/// same way (`sdk/src/airdrop.ts`).
pub fn verify_merkle(root: &[u8; 32], leaf: [u8; 32], proof: &[[u8; 32]]) -> bool {
    let mut node = leaf;
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[&node, sibling]).to_bytes()
        } else {
            hashv(&[sibling, &node]).to_bytes()
        };
    }
    node == *root
}

#[derive(Accounts)]
pub struct InitTokenomics<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed custody PDA; must own `airdrop_vault`.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.hub_mint, owner = vault (verified in handler).
    pub airdrop_vault: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + TokenomicsConfig::INIT_SPACE, seeds = [SEED_TOKENOMICS], bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    pub system_program: Program<'info, System>,
}

/// Writes the Appendix plan. Airdrop numbers stay zero until `set_airdrop_root`.
pub fn init_tokenomics(ctx: Context<InitTokenomics>) -> Result<()> {
    require_token_account(
        &ctx.accounts.airdrop_vault,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.vault.key,
    )?;
    let t = &mut ctx.accounts.tokenomics;
    t.max_supply_units = HUB_MAX_SUPPLY_UNITS;
    t.airdrop_per_desk_units = AIRDROP_PER_DESK_UNITS;
    t.treasury_lock_bp = TREASURY_LOCK_BP;
    t.team_bp = TEAM_ALLOCATION_BP;
    t.airdrop_root = [0u8; 32];
    t.airdrop_vault = ctx.accounts.airdrop_vault.key();
    t.airdrop_claimed_units = 0;
    t.airdrop_claims = 0;
    t.airdrop_open = false;
    t.bump = ctx.bumps.tokenomics;
    t.apply_snapshot(0)?;
    t.snapshot_ts = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct SetAirdropRoot<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
}

/// Publishes (or, before any claim, replaces) the snapshot root and desk count, and sets the
/// claims switch. Once a claim has been paid the root and count are frozen; only `open` moves.
pub fn set_airdrop_root(
    ctx: Context<SetAirdropRoot>,
    root: [u8; 32],
    desk_count: u32,
    open: bool,
) -> Result<()> {
    let t = &mut ctx.accounts.tokenomics;
    if t.airdrop_claims > 0 {
        require!(
            root == t.airdrop_root && desk_count == t.snapshot_desk_count,
            HubError::AirdropLocked
        );
    } else {
        t.airdrop_root = root;
        t.apply_snapshot(desk_count)?;
        t.snapshot_ts = Clock::get()?.unix_timestamp;
    }
    require!(
        !open || (t.airdrop_root != [0u8; 32] && t.snapshot_desk_count > 0),
        HubError::AirdropClosed
    );
    t.airdrop_open = open;
    emit!(AirdropRootSet {
        root: t.airdrop_root,
        desk_count: t.snapshot_desk_count,
        airdrop_units: t.airdrop_units,
        airdrop_bp: t.airdrop_bp,
        public_bp: t.public_bp,
        open,
        ts: t.snapshot_ts,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimAirdrop<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    /// CHECK: Metaplex Core asset; owner + collection verified in `require_desk`.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Account<'info, TreasuryState>,
    /// CHECK: program-signed owner of `airdrop_vault`.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for TransferChecked.
    #[account(address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: funding account recorded on TokenomicsConfig at init.
    #[account(mut, address = tokenomics.airdrop_vault @ HubError::InvalidTokenAccount)]
    pub airdrop_vault: UncheckedAccount<'info>,
    /// CHECK: claimant's $HUB token account (mint/owner verified in handler).
    #[account(mut)]
    pub claimant_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    /// Receipt — `init` (not `init_if_needed`) makes a second claim for the same desk fail.
    #[account(init, payer = claimant, space = 8 + AirdropClaim::INIT_SPACE, seeds = [SEED_AIRDROP, desk_asset.key().as_ref()], bump)]
    pub claim: Account<'info, AirdropClaim>,
    pub system_program: Program<'info, System>,
}

/// Pays `amount_units` to the desk's current owner if `(asset, amount)` is in the snapshot.
pub fn claim_airdrop(
    ctx: Context<ClaimAirdrop>,
    amount_units: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let t = &ctx.accounts.tokenomics;
    require!(t.airdrop_open, HubError::AirdropClosed);
    require!(amount_units > 0, HubError::ZeroAmount);
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_keys_eq!(
        asset.owner,
        ctx.accounts.claimant.key(),
        HubError::NotDeskOwner
    );
    require_token_account(
        &ctx.accounts.claimant_hub,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.claimant.key,
    )?;
    let leaf = airdrop_leaf(ctx.accounts.desk_asset.key, amount_units);
    require!(
        verify_merkle(&t.airdrop_root, leaf, &proof),
        HubError::AirdropInvalidProof
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.airdrop_vault,
        &ctx.accounts.hub_mint,
        &ctx.accounts.claimant_hub,
        &ctx.accounts.vault,
        amount_units,
        &[seeds],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.claim;
    c.asset = ctx.accounts.desk_asset.key();
    c.claimant = ctx.accounts.claimant.key();
    c.amount_units = amount_units;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    let t = &mut ctx.accounts.tokenomics;
    t.airdrop_claimed_units = t
        .airdrop_claimed_units
        .checked_add(amount_units)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    t.airdrop_claims = t
        .airdrop_claims
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    emit!(AirdropClaimed {
        asset: c.asset,
        claimant: c.claimant,
        amount_units,
        total_claimed_units: t.airdrop_claimed_units,
        claims: t.airdrop_claims,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> TokenomicsConfig {
        TokenomicsConfig {
            max_supply_units: HUB_MAX_SUPPLY_UNITS,
            airdrop_per_desk_units: AIRDROP_PER_DESK_UNITS,
            snapshot_desk_count: 0,
            snapshot_ts: 0,
            airdrop_units: 0,
            airdrop_bp: 0,
            treasury_lock_bp: TREASURY_LOCK_BP,
            team_bp: TEAM_ALLOCATION_BP,
            public_bp: 0,
            airdrop_root: [0u8; 32],
            airdrop_vault: Pubkey::default(),
            airdrop_claimed_units: 0,
            airdrop_claims: 0,
            airdrop_open: false,
            bump: 0,
        }
    }

    /// 1,000 desks × 10,000 = 10M $HUB = 1.00% → public 94.00%, team 0.
    #[test]
    fn split_follows_desk_count() {
        let mut t = plan();
        t.apply_snapshot(1_000).unwrap();
        assert_eq!(t.airdrop_units, 10_000_000 * HUB_UNIT);
        assert_eq!(t.airdrop_bp, 100);
        assert_eq!(t.public_bp, 9_400);
        assert_eq!(
            t.airdrop_bp + t.treasury_lock_bp + t.team_bp + t.public_bp,
            10_000
        );
    }

    /// bp floors: 15 desks = 150k $HUB = 0.015% → 1 bp; units stay exact.
    #[test]
    fn bp_floors_but_units_are_exact() {
        let mut t = plan();
        t.apply_snapshot(15).unwrap();
        assert_eq!(t.airdrop_units, 150_000 * HUB_UNIT);
        assert_eq!(t.airdrop_bp, 1);
        assert_eq!(t.public_bp, 9_499);
        t.apply_snapshot(0).unwrap();
        assert_eq!((t.airdrop_bp, t.public_bp), (0, 9_500));
    }

    /// 95,001 desks would need 950.01M $HUB — more than the 95% left after the treasury lock.
    #[test]
    fn rejects_carve_outs_over_supply() {
        let mut t = plan();
        assert!(t.apply_snapshot(95_001).is_err());
        assert!(t.apply_snapshot(95_000).is_ok());
        assert_eq!(t.public_bp, 0);
    }

    #[test]
    fn merkle_two_leaves_either_order() {
        let a = airdrop_leaf(&Pubkey::new_unique(), AIRDROP_PER_DESK_UNITS);
        let b = airdrop_leaf(&Pubkey::new_unique(), AIRDROP_PER_DESK_UNITS);
        let root = if a <= b {
            hashv(&[&a, &b]).to_bytes()
        } else {
            hashv(&[&b, &a]).to_bytes()
        };
        assert!(verify_merkle(&root, a, &[b]));
        assert!(verify_merkle(&root, b, &[a]));
        assert!(!verify_merkle(&root, a, &[a]));
        assert!(!verify_merkle(
            &root,
            airdrop_leaf(&Pubkey::new_unique(), 1),
            &[b]
        ));
    }

    #[test]
    fn single_leaf_tree_is_its_own_root() {
        let leaf = airdrop_leaf(&Pubkey::new_unique(), 5);
        assert!(verify_merkle(&leaf, leaf, &[]));
        assert!(!verify_merkle(&[0u8; 32], leaf, &[]));
    }
}
