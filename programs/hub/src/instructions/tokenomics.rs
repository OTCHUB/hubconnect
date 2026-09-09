//! §A7.1 — supply allocation plan + snapshot airdrop.
//!
//! `init_tokenomics` (authority) records the plan once: max supply, per-desk airdrop size,
//! treasury lock and team shares, the vault-owned $HUB account that funds claims, and the
//! vault-owned $HUB account holding the genesis 2% floor (no withdraw instruction ever exists
//! for it). `set_airdrop_root` publishes the desk snapshot as a Merkle root and derives the
//! airdrop / public split from the desk count — capped at `AIRDROP_DESK_CAP` (2,500) and
//! extensible in later rounds as new desks mint (desk_count may only grow once claims start).
//! Both `claim_airdrop` (pull, desk owner signs) and `distribute_airdrop` (push, authority
//! signs — for the genesis "send once to each owner address" distribution) pay against the same
//! leaf/proof scheme and share the same `AirdropClaim` PDA, so a desk can only ever be paid once,
//! regardless of which path is used.

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

/// Pure math: `⌊amount_units × weight_bp / total_weight_bp⌋` — the core split for
/// `distribute_treasury_reward`, factored out here for unit testing.
pub fn reward_share(amount_units: u64, weight_bp: u64, total_weight_bp: u64) -> Result<u64> {
    require!(total_weight_bp > 0, HubError::NoActiveStakers);
    u64::try_from(
        (amount_units as u128)
            .checked_mul(weight_bp as u128)
            .ok_or_else(|| error!(HubError::MathOverflow))?
            / total_weight_bp as u128,
    )
    .map_err(|_| error!(HubError::MathOverflow))
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
    /// CHECK: program-signed custody PDA; must own `airdrop_vault` and `treasury_lock_vault`.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.hub_mint, owner = vault (verified in handler).
    pub airdrop_vault: UncheckedAccount<'info>,
    /// CHECK: spl-token account, mint = config.hub_mint, owner = vault (verified in handler) —
    /// holds the immutable 2% genesis floor; no instruction in this program ever debits it.
    pub treasury_lock_vault: UncheckedAccount<'info>,
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
    require_token_account(
        &ctx.accounts.treasury_lock_vault,
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
    t.snapshot_round = 0;
    t.treasury_lock_vault = ctx.accounts.treasury_lock_vault.key();
    t.treasury_lock_units = HUB_MAX_SUPPLY_UNITS
        .checked_mul(YIELD_RESERVE_BP as u64)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or_else(|| error!(HubError::MathOverflow))?;
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

/// Publishes the snapshot root and desk count, and sets the claims switch. `desk_count` is
/// capped at `AIRDROP_DESK_CAP` (2,500) on-chain. Before any claim has been paid a round may
/// freely replace the root/desk_count (fixing a bad snapshot pre-launch); once claims have
/// started a later call may only *grow* `desk_count` (never shrink it) — this is how the team
/// runs a second/third round to onboard desks minted after an earlier round without disturbing
/// desks already paid (each is independently guarded by its own `AirdropClaim` PDA regardless
/// of how the root changes). Calling this again with the same `(root, desk_count)` — e.g. only
/// to flip `open` — is a no-op on the snapshot fields and does not bump `snapshot_round`.
pub fn set_airdrop_root(
    ctx: Context<SetAirdropRoot>,
    root: [u8; 32],
    desk_count: u32,
    open: bool,
) -> Result<()> {
    require!(desk_count <= AIRDROP_DESK_CAP, HubError::AirdropCapExceeded);
    let t = &mut ctx.accounts.tokenomics;
    if t.airdrop_claims > 0 {
        require!(desk_count >= t.snapshot_desk_count, HubError::AirdropLocked);
    }
    let changed = root != t.airdrop_root || desk_count != t.snapshot_desk_count;
    if changed {
        t.airdrop_root = root;
        t.apply_snapshot(desk_count)?;
        t.snapshot_ts = Clock::get()?.unix_timestamp;
        t.snapshot_round = t
            .snapshot_round
            .checked_add(1)
            .ok_or_else(|| error!(HubError::MathOverflow))?;
    }
    require!(
        !open || (t.airdrop_root != [0u8; 32] && t.snapshot_desk_count > 0),
        HubError::AirdropClosed
    );
    t.airdrop_open = open;
    emit!(AirdropRootSet {
        root: t.airdrop_root,
        desk_count: t.snapshot_desk_count,
        round: t.snapshot_round,
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

#[derive(Accounts)]
pub struct DistributeAirdrop<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized, constraint = !config.paused @ HubError::Paused)]
    pub config: Account<'info, Config>,
    /// CHECK: Metaplex Core asset; current owner read directly — no signature required from
    /// them, this is a push. Whoever holds the desk right now receives the payout, matching the
    /// genesis policy of paying "the OTC desk NFT owner at distribution time."
    pub desk_asset: UncheckedAccount<'info>,
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
    /// CHECK: the desk's current owner's $HUB token account — verified against `desk_asset`'s
    /// actual on-chain owner in the handler, not against a signer.
    #[account(mut)]
    pub owner_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    /// Same seeds as `ClaimAirdrop::claim` — `init` makes a second payout for the same desk fail
    /// regardless of whether the first one went through `claim_airdrop` or `distribute_airdrop`.
    #[account(init, payer = authority, space = 8 + AirdropClaim::INIT_SPACE, seeds = [SEED_AIRDROP, desk_asset.key().as_ref()], bump)]
    pub claim: Account<'info, AirdropClaim>,
    pub system_program: Program<'info, System>,
}

/// Authority-pushed payout for the genesis distribution: pays `amount_units` straight to the
/// desk's current owner if `(asset, amount)` is in the snapshot — no signature from the owner
/// required. `owner_hub` must already be their $HUB associated token account (the distribution
/// script creates it ahead of time, e.g. idempotent-create in the same tx). To satisfy "one
/// transfer per address," the off-chain distribution script should batch every desk owned by the
/// same address into a single transaction (multiple `distribute_airdrop` instructions, one net
/// settlement) rather than issuing one transaction per desk.
pub fn distribute_airdrop(
    ctx: Context<DistributeAirdrop>,
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
    require_token_account(
        &ctx.accounts.owner_hub,
        &ctx.accounts.config.hub_mint,
        &asset.owner,
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
        &ctx.accounts.owner_hub,
        &ctx.accounts.vault,
        amount_units,
        &[seeds],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.claim;
    c.asset = ctx.accounts.desk_asset.key();
    c.claimant = asset.owner;
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
    emit!(AirdropDistributed {
        asset: c.asset,
        owner: c.claimant,
        amount_units,
        total_claimed_units: t.airdrop_claimed_units,
        claims: t.airdrop_claims,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FundTreasuryReward<'info> {
    #[account(mut)]
    pub treasury: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = treasury @ HubError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    /// CHECK: matched against config.hub_mint; decimals read for TransferChecked.
    #[account(address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: treasury's $HUB source account holding the swapped launcher-reward proceeds.
    #[account(mut)]
    pub treasury_hub: UncheckedAccount<'info>,
    /// CHECK: recorded on TokenomicsConfig at init; holds the genesis floor + reward deposits.
    #[account(mut, address = tokenomics.treasury_lock_vault @ HubError::InvalidTokenAccount)]
    pub treasury_lock_vault: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
}

/// Treasury deposits $HUB already swapped off-chain from the OTC launcher's holders-in-stock
/// reward leg (same source as `CreatorFeeState`'s `Stack` leg — see `record_creator_fee_stack` —
/// but routed here instead of the ordinary treasury float) into `treasury_lock_vault`, on top of
/// the immutable genesis floor. Enforced on-chain (`TransferChecked`, not merely attested).
/// Earmarked as `reward_pending_units` until `open_reward_round` snapshots it for payout.
pub fn fund_treasury_reward(ctx: Context<FundTreasuryReward>, hub_amount: u64) -> Result<()> {
    require!(hub_amount > 0, HubError::ZeroAmount);
    require_token_account(
        &ctx.accounts.treasury_hub,
        &ctx.accounts.config.hub_mint,
        ctx.accounts.treasury.key,
    )?;
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.treasury_hub,
        &ctx.accounts.hub_mint,
        &ctx.accounts.treasury_lock_vault,
        &ctx.accounts.treasury,
        hub_amount,
        &[],
    )?;
    let t = &mut ctx.accounts.tokenomics;
    t.reward_pending_units = t
        .reward_pending_units
        .checked_add(hub_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    t.reward_deposited_units = t
        .reward_deposited_units
        .checked_add(hub_amount)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    emit!(TreasuryRewardFunded {
        hub_amount,
        pending_after: t.reward_pending_units,
        total_deposited: t.reward_deposited_units,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct OpenRewardRound<'info> {
    /// Permissionless: deterministic snapshot, like `clear_creator_fees` / `finalize_epoch`.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Account<'info, TokenomicsConfig>,
    #[account(
        init, payer = payer, space = 8 + RewardRound::INIT_SPACE,
        seeds = [SEED_REWARD_ROUND, &tokenomics.reward_round_count.to_le_bytes()], bump
    )]
    pub round: Account<'info, RewardRound>,
    pub system_program: Program<'info, System>,
}

/// Snapshots the whole `reward_pending_units` balance across the live Σw of active desks
/// (`Config.total_weight_bp`) into a new `RewardRound`, then zeroes the pending balance.
/// Requires at least one active desk — otherwise there is nobody to distribute to.
pub fn open_reward_round(ctx: Context<OpenRewardRound>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(config.total_weight_bp > 0, HubError::NoActiveStakers);
    let t = &mut ctx.accounts.tokenomics;
    require!(t.reward_pending_units > 0, HubError::NoRewardPending);

    let amount_units = t.reward_pending_units;
    t.reward_pending_units = 0;

    let now = Clock::get()?.unix_timestamp;
    let r = &mut ctx.accounts.round;
    r.index = t.reward_round_count;
    r.amount_units = amount_units;
    r.total_weight_bp = config.total_weight_bp;
    r.distributed_units = 0;
    r.claims = 0;
    r.opened_ts = now;
    r.bump = ctx.bumps.round;

    t.reward_round_count = t
        .reward_round_count
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    emit!(TreasuryRewardRoundOpened {
        round: r.index,
        amount_units,
        total_weight_bp: r.total_weight_bp,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(round_index: u32)]
pub struct DistributeTreasuryReward<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = authority @ HubError::Unauthorized, constraint = !config.paused @ HubError::Paused)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: Metaplex Core asset; current owner read directly — this is a push, matching
    /// `distribute_airdrop`'s "pay whoever holds the desk right now" policy.
    pub desk_asset: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_TIER, desk_asset.key().as_ref()], bump = desk_tier.bump,
        constraint = !desk_tier.voided && desk_tier.tier > 0 @ HubError::DeskNotActive
    )]
    pub desk_tier: Box<Account<'info, DeskTier>>,
    #[account(mut, seeds = [SEED_TOKENOMICS], bump = tokenomics.bump)]
    pub tokenomics: Box<Account<'info, TokenomicsConfig>>,
    #[account(mut, seeds = [SEED_REWARD_ROUND, &round_index.to_le_bytes()], bump = round.bump)]
    pub round: Box<Account<'info, RewardRound>>,
    #[account(seeds = [SEED_TREASURY], bump = treasury_state.bump)]
    pub treasury_state: Box<Account<'info, TreasuryState>>,
    /// CHECK: program-signed owner of `treasury_lock_vault`.
    #[account(seeds = [SEED_VAULT], bump = treasury_state.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: matched against config.hub_mint; decimals read for TransferChecked.
    #[account(address = config.hub_mint @ HubError::InvalidTokenAccount)]
    pub hub_mint: UncheckedAccount<'info>,
    /// CHECK: recorded on TokenomicsConfig at init.
    #[account(mut, address = tokenomics.treasury_lock_vault @ HubError::InvalidTokenAccount)]
    pub treasury_lock_vault: UncheckedAccount<'info>,
    /// CHECK: the desk's current owner's $HUB token account — verified against `desk_asset`'s
    /// actual on-chain owner in the handler, not against a signer.
    #[account(mut)]
    pub owner_hub: UncheckedAccount<'info>,
    /// CHECK: classic SPL Token program, asserted in `transfer_checked`.
    pub token_program: UncheckedAccount<'info>,
    /// One payout per desk asset per round.
    #[account(
        init, payer = authority, space = 8 + RewardClaim::INIT_SPACE,
        seeds = [SEED_REWARD_CLAIM, &round_index.to_le_bytes(), desk_asset.key().as_ref()], bump
    )]
    pub claim: Account<'info, RewardClaim>,
    pub system_program: Program<'info, System>,
}

/// Pays an active desk's tier-weighted share of an open `RewardRound`:
/// `⌊round.amount_units × weight_bp(desk_tier.tier) / round.total_weight_bp⌋`, from
/// `treasury_lock_vault`. The payout is capped so `round.distributed_units` never exceeds
/// `round.amount_units` (`RewardRoundExceeded` if Σw drifted upward since the round opened,
/// e.g. a desk upgraded tier mid-round) — the vault can never be over-drawn past what was
/// actually deposited by `fund_treasury_reward`. Any floor/weight-drift dust simply stays in the
/// vault, available to the next round.
pub fn distribute_treasury_reward(
    ctx: Context<DistributeTreasuryReward>,
    round_index: u32,
) -> Result<()> {
    let asset = require_desk(
        &ctx.accounts.desk_asset,
        &ctx.accounts.config.desk_collection,
    )?;
    require_token_account(
        &ctx.accounts.owner_hub,
        &ctx.accounts.config.hub_mint,
        &asset.owner,
    )?;
    let w = ctx.accounts.config.weight_bp(ctx.accounts.desk_tier.tier)?;
    let round = &mut ctx.accounts.round;
    let amount_units = reward_share(round.amount_units, w, round.total_weight_bp)?;
    require!(amount_units > 0, HubError::ZeroAmount);
    let distributed_after = round
        .distributed_units
        .checked_add(amount_units)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    require!(
        distributed_after <= round.amount_units,
        HubError::RewardRoundExceeded
    );

    let vault_bump = ctx.accounts.treasury_state.vault_bump;
    let seeds: &[&[u8]] = &[SEED_VAULT, &[vault_bump]];
    transfer_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.treasury_lock_vault,
        &ctx.accounts.hub_mint,
        &ctx.accounts.owner_hub,
        &ctx.accounts.vault,
        amount_units,
        &[seeds],
    )?;

    round.distributed_units = distributed_after;
    round.claims = round
        .claims
        .checked_add(1)
        .ok_or_else(|| error!(HubError::MathOverflow))?;
    let round_distributed_units = round.distributed_units;
    let claims = round.claims;

    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.claim;
    c.round = round_index;
    c.asset = ctx.accounts.desk_asset.key();
    c.owner = asset.owner;
    c.amount_units = amount_units;
    c.claimed_ts = now;
    c.bump = ctx.bumps.claim;

    let t = &mut ctx.accounts.tokenomics;
    t.reward_distributed_units = t
        .reward_distributed_units
        .checked_add(amount_units)
        .ok_or_else(|| error!(HubError::MathOverflow))?;

    emit!(TreasuryRewardDistributed {
        round: round_index,
        asset: c.asset,
        owner: c.owner,
        amount_units,
        round_distributed_units,
        claims,
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
            snapshot_round: 0,
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
            treasury_lock_vault: Pubkey::default(),
            treasury_lock_units: 0,
            reward_deposited_units: 0,
            reward_distributed_units: 0,
            reward_pending_units: 0,
            reward_round_count: 0,
            bump: 0,
        }
    }

    /// 1,000 desks × 10,000 = 10M $HUB = 1.00% → public 96.50% (treasury lock now 2.5%), team 0.
    #[test]
    fn split_follows_desk_count() {
        let mut t = plan();
        t.apply_snapshot(1_000).unwrap();
        assert_eq!(t.airdrop_units, 10_000_000 * HUB_UNIT);
        assert_eq!(t.airdrop_bp, 100);
        assert_eq!(t.public_bp, 9_650);
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
        assert_eq!(t.public_bp, 9_749);
        t.apply_snapshot(0).unwrap();
        assert_eq!((t.airdrop_bp, t.public_bp), (0, 9_750));
    }

    /// 97,501 desks would need 975.01M $HUB — more than the 97.5% left after the treasury lock.
    #[test]
    fn rejects_carve_outs_over_supply() {
        let mut t = plan();
        assert!(t.apply_snapshot(97_501).is_err());
        assert!(t.apply_snapshot(97_500).is_ok());
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

    /// Four desks T1..T4 (Σw = 58,500 bp) share a 1,000 $HUB reward round in tier proportion —
    /// same weight table `finalize_epoch`'s `round_credit` uses for the primary yield leg.
    #[test]
    fn reward_share_splits_by_tier_weight() {
        let total_w: u64 = TIER_WEIGHTS_BP.iter().map(|w| *w as u64).sum();
        let amount = 1_000 * HUB_UNIT;
        let shares: Vec<u64> = TIER_WEIGHTS_BP
            .iter()
            .map(|w| reward_share(amount, *w as u64, total_w).unwrap())
            .collect();
        assert_eq!(shares[0], amount * 10_000 / 58_500);
        assert!(shares[3] > shares[2] && shares[2] > shares[1] && shares[1] > shares[0]);
        // Σ shares ≤ amount (floor division only ever loses, never overpays).
        assert!(shares.iter().sum::<u64>() <= amount);
    }

    #[test]
    fn reward_share_rejects_zero_total_weight() {
        assert!(reward_share(1_000, 10_000, 0).is_err());
    }

    #[test]
    fn reward_share_overflow_is_an_error() {
        assert!(reward_share(u64::MAX, u64::MAX, 1).is_err());
    }
}
