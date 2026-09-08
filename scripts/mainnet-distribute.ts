// Mainnet genesis airdrop distribution (§A7.1) — authority-pushed payout, one desk asset at a
// time via `distribute_airdrop`. Reads the JSON produced by mainnet-airdrop-snapshot.ts,
// (optionally) publishes the Merkle root via `set_airdrop_root`, then pays every desk's *current*
// owner. Re-checks the live owner right before paying — a desk traded since the snapshot pays its
// new owner, matching the on-chain policy (see `DistributeAirdrop` in tokenomics.rs) — and skips
// any desk that already has an `AirdropClaim` PDA, so the script is safe to re-run after a
// partial failure (idempotent; no separate "resume" flag needed).
//
//   npx ts-node -T scripts/mainnet-distribute.ts --in genesis-snapshot.json --publish-root --open
//   npx ts-node -T scripts/mainnet-distribute.ts --in genesis-snapshot.json           # just pay
//   npx ts-node -T scripts/mainnet-distribute.ts --in genesis-snapshot.json --dry-run
//
// §A6.3/§A7.1 bridge — `--reward` switches this same script into the treasury reward-redistribution
// flow: the `treasury_lock_vault` (2% genesis floor) also holds $HUB swapped off-chain from the OTC
// launcher's holders-in-stock reward leg (deposited via `fund_treasury_reward`), which gets
// redistributed to every *active* $HUB desk holder by tier weight (`open_reward_round` +
// `distribute_treasury_reward`). Same idempotency guarantees as the airdrop leg above, keyed on
// `RewardClaim` PDAs (one payout per desk per round) instead of `AirdropClaim`.
//
//   npx ts-node -T scripts/mainnet-distribute.ts --reward --fund 50000            # treasury deposit
//   npx ts-node -T scripts/mainnet-distribute.ts --reward --open                  # snapshot → new round
//   npx ts-node -T scripts/mainnet-distribute.ts --reward --round 0               # pay round 0
//   npx ts-node -T scripts/mainnet-distribute.ts --reward --fund 50000 --open --round 0 --dry-run
import "dotenv/config";
import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  HUB_DECIMALS,
  HUB_IDL,
  airdropClaimPda,
  configPda,
  fetchCoreAssetOwner,
  fetchDeskOwners,
  rewardClaimPda,
  rewardRoundPda,
  tierPda,
  tokenomicsPda,
  treasuryPda,
  vaultPda,
  type HubProgram,
} from "../sdk/src";
import {
  ata,
  createAtaIdempotent,
  explorer,
  loadMainnetKeypair,
  mainnetRpc,
  parseFlags,
  redactRpc,
  sleep,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./lib/mainnet";

type SnapshotEntry = {
  asset: string;
  owner: string;
  amountUnits: string;
  proof: string[]; // hex, 32 bytes each
};
type Snapshot = { programId: string; root: string; deskCount: number; entries: SnapshotEntry[] };

function parseArgs() {
  const { get, has } = parseFlags(process.argv.slice(2));
  const roundRaw = get("--round");
  return {
    in: get("--in") ?? "genesis-snapshot.json",
    publishRoot: has("--publish-root"),
    open: !has("--closed"),
    dryRun: has("--dry-run"),
    force: has("--force"),
    batch: Number(get("--batch") ?? 2),
    rpc: get("--rpc") ?? null,
    // Treasury reward-redistribution mode (§A6.3 bridge) — mutually exclusive with the airdrop
    // flow above; none of --in/--publish-root/--closed/--force apply here.
    reward: has("--reward"),
    fund: get("--fund") ?? null, // whole $HUB, e.g. "50000" — converted to base units below
    openRound: has("--open"),
    round: roundRaw != null ? Number(roundRaw) : null,
  };
}

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const proofArgs = (hexes: string[]) => hexes.map((h) => Array.from(hexToBytes(h)));

async function main() {
  const args = parseArgs();
  const rpc = mainnetRpc(args.rpc);
  const connection = new Connection(rpc, "confirmed");
  const payer = loadMainnetKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);
  console.log(
    `rpc ${redactRpc(rpc)} · authority ${payer.publicKey.toBase58()} · program ${program.programId.toBase58()}`,
  );

  const [configKey] = configPda(program.programId);
  const cfg = await program.account.config.fetch(configKey);
  const [tokenomicsKey] = tokenomicsPda(program.programId);
  const tok = await program.account.tokenomicsConfig.fetchNullable(tokenomicsKey);
  if (!tok) throw new Error("TokenomicsConfig not initialized — run init_tokenomics first");

  if (args.reward) {
    await runRewardMode(args, {
      connection,
      provider,
      program,
      payer,
      cfg,
      configKey,
      tokenomicsKey,
    });
    return;
  }

  if (!cfg.authority.equals(payer.publicKey)) {
    throw new Error(`signer is not Config.authority (${cfg.authority.toBase58()})`);
  }
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(args.in, "utf8"));
  if (snapshot.programId !== program.programId.toBase58()) {
    throw new Error(
      `snapshot targets program ${snapshot.programId}, this SDK is bound to ${program.programId.toBase58()}`,
    );
  }

  const rootBytes = hexToBytes(snapshot.root);
  const onChainRootHex = Buffer.from(tok.airdropRoot).toString("hex");
  const rootMatches = onChainRootHex === snapshot.root;
  if (!rootMatches && tok.airdropClaims > 0 && !args.force) {
    throw new Error(
      `on-chain root (${onChainRootHex}) differs from the snapshot root (${snapshot.root}) and ` +
        `${tok.airdropClaims} claim(s) are already paid — refusing to overwrite without --force`,
    );
  }

  if (!rootMatches) {
    if (!args.publishRoot)
      throw new Error("on-chain root not published yet — re-run with --publish-root");
    if (args.dryRun) {
      console.log(
        `[dry-run] would set_airdrop_root(desk_count=${snapshot.deskCount}, open=${args.open})`,
      );
    } else {
      const sig = await program.methods
        .setAirdropRoot(Array.from(rootBytes), snapshot.deskCount, args.open)
        .accountsStrict({
          authority: payer.publicKey,
          config: configKey,
          tokenomics: tokenomicsKey,
        })
        .rpc();
      console.log(
        `root published (${snapshot.deskCount} desks, open=${args.open}) → ${explorer(sig, "tx")}`,
      );
    }
  } else {
    console.log(`on-chain root already matches snapshot (round ${tok.snapshotRound})`);
  }

  if (!tok.airdropOpen && !args.dryRun && !(args.publishRoot && args.open)) {
    console.warn(
      "⚠ airdrop_open is false on-chain — distribute_airdrop will fail until it's opened",
    );
  }

  const [treasuryKey] = treasuryPda(program.programId);
  const [vaultKey] = vaultPda(program.programId);
  const hubMint = cfg.hubMint as PublicKey;
  const airdropVault = tok.airdropVault as PublicKey;

  const pending: SnapshotEntry[] = [];
  for (const e of snapshot.entries) {
    const [claimKey] = airdropClaimPda(program.programId, new PublicKey(e.asset));
    const already = await program.account.airdropClaim.fetchNullable(claimKey);
    if (!already) pending.push(e);
  }
  const skipped = snapshot.entries.length - pending.length;
  console.log(`${pending.length} desk(s) pending · ${skipped} already paid`);
  if (args.dryRun) {
    console.log(`[dry-run] would distribute to ${pending.length} desk(s) — exiting`);
    return;
  }

  let paid = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += args.batch) {
    const group = pending.slice(i, i + args.batch);
    const tx = new Transaction();
    const settled: string[] = [];
    for (const e of group) {
      const asset = new PublicKey(e.asset);
      const liveOwner = await fetchCoreAssetOwner(connection, asset);
      if (!liveOwner) {
        console.error(`  SKIP ${e.asset}: not found on-chain (burned?)`);
        failed++;
        continue;
      }
      if (!liveOwner.equals(new PublicKey(e.owner))) {
        console.log(
          `  ℹ ${e.asset} traded since snapshot — paying live owner ${liveOwner.toBase58()}`,
        );
      }
      const ownerHub = ata(liveOwner, hubMint);
      if (!(await connection.getAccountInfo(ownerHub))) {
        tx.add(createAtaIdempotent(payer.publicKey, liveOwner, hubMint));
      }
      const [claimKey] = airdropClaimPda(program.programId, asset);
      tx.add(
        await program.methods
          .distributeAirdrop(new BN(e.amountUnits), proofArgs(e.proof))
          .accountsStrict({
            authority: payer.publicKey,
            config: configKey,
            deskAsset: asset,
            tokenomics: tokenomicsKey,
            treasuryState: treasuryKey,
            vault: vaultKey,
            hubMint,
            airdropVault,
            ownerHub,
            tokenProgram: TOKEN_PROGRAM_ID,
            claim: claimKey,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .instruction(),
      );
      settled.push(e.asset);
    }
    if (settled.length === 0) continue;
    try {
      const sig = await provider.sendAndConfirm(tx, [payer]);
      paid += settled.length;
      console.log(`  PAID ${settled.map((a) => a.slice(0, 6)).join(",")} → ${explorer(sig, "tx")}`);
    } catch (e) {
      failed += settled.length;
      console.error(`  FAILED [${settled.join(",")}]: ${(e as Error).message}`);
    }
    await sleep(250);
  }

  console.log(
    `\ndone: ${paid} paid · ${skipped} already paid · ${failed} failed (of ${snapshot.entries.length})`,
  );
  if (failed > 0) {
    console.log("re-run the same command to retry failures — already-paid desks are skipped.");
    process.exitCode = 1;
  }
}

type RewardModeCtx = {
  connection: Connection;
  provider: AnchorProvider;
  program: HubProgram;
  payer: Keypair;
  cfg: Awaited<ReturnType<HubProgram["account"]["config"]["fetch"]>>;
  configKey: PublicKey;
  tokenomicsKey: PublicKey;
};
type DeskTierAccount = Awaited<ReturnType<HubProgram["account"]["deskTier"]["fetchNullable"]>>;

/** Whole $HUB (e.g. "50000") → base units at the mint's on-chain decimals. Rejects anything but a
 * plain non-negative integer so a real-money treasury transfer never silently rounds. */
function hubUnitsFromWhole(input: string): BN {
  if (!/^\d+$/.test(input)) {
    throw new Error(`--fund expects a whole-$HUB integer (e.g. "50000"), got "${input}"`);
  }
  return new BN(input).mul(new BN(10).pow(new BN(HUB_DECIMALS)));
}

/**
 * §A6.3 bridge — treasury reward-redistribution flow, run via `--reward`:
 *   --fund <whole $HUB>  fund_treasury_reward: treasury deposits swapped launcher-reward $HUB
 *                        into `treasury_lock_vault` (Config.treasury must sign; separate keypair
 *                        from the authority when HUB_MAINNET_TREASURY_WALLET is set).
 *   --open               open_reward_round: permissionless snapshot of the pending deposit across
 *                        the live Σw of active desks into a new `RewardRound`.
 *   --round <index>      distribute_treasury_reward to every active desk's *current* owner,
 *                        tier-weighted, skipping any desk that already has a `RewardClaim` for
 *                        this round — safe to re-run after a partial failure, same as the airdrop
 *                        leg above.
 * Flags combine in one invocation (fund → open → distribute), each gated on the others succeeding.
 */
async function runRewardMode(args: ReturnType<typeof parseArgs>, ctx: RewardModeCtx) {
  const { connection, provider, program, payer, cfg, configKey, tokenomicsKey } = ctx;
  const [treasuryKey] = treasuryPda(program.programId);
  const [vaultKey] = vaultPda(program.programId);
  const hubMint = cfg.hubMint as PublicKey;
  const tok = await program.account.tokenomicsConfig.fetch(tokenomicsKey);

  if (args.fund != null) {
    const hubAmountUnits = hubUnitsFromWhole(args.fund);
    const treasuryWallet = loadMainnetKeypair(
      process.env.HUB_MAINNET_TREASURY_WALLET ?? process.env.HUB_MAINNET_WALLET,
    );
    if (!cfg.treasury.equals(treasuryWallet.publicKey)) {
      throw new Error(
        `treasury signer ${treasuryWallet.publicKey.toBase58()} does not match Config.treasury ` +
          `(${cfg.treasury.toBase58()}) — set HUB_MAINNET_TREASURY_WALLET to the correct keypair`,
      );
    }
    const treasuryHub = ata(treasuryWallet.publicKey, hubMint);
    if (args.dryRun) {
      console.log(
        `[dry-run] would fund_treasury_reward(${args.fund} $HUB = ${hubAmountUnits.toString()} units) from ${treasuryHub.toBase58()}`,
      );
    } else {
      const sig = await program.methods
        .fundTreasuryReward(hubAmountUnits)
        .accountsStrict({
          treasury: treasuryWallet.publicKey,
          config: configKey,
          tokenomics: tokenomicsKey,
          hubMint,
          treasuryHub,
          treasuryLockVault: tok.treasuryLockVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([treasuryWallet])
        .rpc();
      console.log(`funded ${args.fund} $HUB into treasury_lock_vault → ${explorer(sig, "tx")}`);
    }
  }

  if (args.openRound) {
    const tokNow = await program.account.tokenomicsConfig.fetch(tokenomicsKey);
    if (tokNow.rewardPendingUnits.isZero()) {
      console.log("reward_pending_units is 0 — nothing to snapshot, skipping --open");
    } else {
      const roundIndex = tokNow.rewardRoundCount;
      const [roundKey] = rewardRoundPda(program.programId, roundIndex);
      if (args.dryRun) {
        console.log(
          `[dry-run] would open_reward_round → round ${roundIndex} (${tokNow.rewardPendingUnits.toString()} pending units)`,
        );
      } else {
        const sig = await program.methods
          .openRewardRound()
          .accountsStrict({
            payer: payer.publicKey,
            config: configKey,
            tokenomics: tokenomicsKey,
            round: roundKey,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .rpc();
        console.log(`opened reward round ${roundIndex} → ${explorer(sig, "tx")}`);
        if (args.round == null) args.round = roundIndex; // distribute what we just opened by default
      }
    }
  }

  if (args.round == null) return;
  if (!cfg.authority.equals(payer.publicKey)) {
    throw new Error(
      `signer is not Config.authority (${cfg.authority.toBase58()}) — required for distribute_treasury_reward`,
    );
  }

  const roundIndex = args.round;
  const [roundKey] = rewardRoundPda(program.programId, roundIndex);
  const round = await program.account.rewardRound.fetchNullable(roundKey);
  if (!round) throw new Error(`reward round ${roundIndex} not found — run --open first`);
  console.log(
    `round ${roundIndex}: ${round.distributedUnits.toString()}/${round.amountUnits.toString()} units distributed · Σw=${round.totalWeightBp.toString()}bp · ${round.claims} claim(s) so far`,
  );

  const owners = await fetchDeskOwners(connection, cfg.deskCollection as PublicKey);
  if (owners.length === 0) throw new Error("no desk assets found in the collection");

  // Bulk-fetch each desk's DeskTier (tier + voided) — chunk to stay under RPCs' ~100-key
  // getMultipleAccounts limit.
  const tierKeys = owners.map((o) => tierPda(program.programId, o.asset)[0]);
  const tiers: DeskTierAccount[] = [];
  for (let i = 0; i < tierKeys.length; i += 100) {
    tiers.push(...(await program.account.deskTier.fetchMultiple(tierKeys.slice(i, i + 100))));
  }

  const active = owners
    .map((o, i) => ({ ...o, tierAccount: tiers[i] }))
    .filter((o) => o.tierAccount && !o.tierAccount.voided && o.tierAccount.tier > 0);
  console.log(`${active.length} active desk(s) of ${owners.length} total in the collection`);
  if (active.length === 0) {
    console.log("no active desks to pay — exiting");
    return;
  }

  const pending: typeof active = [];
  for (const d of active) {
    const [claimKey] = rewardClaimPda(program.programId, roundIndex, d.asset);
    const already = await program.account.rewardClaim.fetchNullable(claimKey);
    if (!already) pending.push(d);
  }
  const skipped = active.length - pending.length;
  console.log(`${pending.length} desk(s) pending payout · ${skipped} already paid this round`);
  if (args.dryRun) {
    console.log(
      `[dry-run] would distribute round ${roundIndex} to ${pending.length} desk(s) — exiting`,
    );
    return;
  }

  let paid = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += args.batch) {
    const group = pending.slice(i, i + args.batch);
    const tx = new Transaction();
    const settled: string[] = [];
    for (const d of group) {
      const liveOwner = await fetchCoreAssetOwner(connection, d.asset);
      if (!liveOwner) {
        console.error(`  SKIP ${d.asset.toBase58()}: not found on-chain (burned?)`);
        failed++;
        continue;
      }
      const ownerHub = ata(liveOwner, hubMint);
      if (!(await connection.getAccountInfo(ownerHub))) {
        tx.add(createAtaIdempotent(payer.publicKey, liveOwner, hubMint));
      }
      const [deskTierKey] = tierPda(program.programId, d.asset);
      const [claimKey] = rewardClaimPda(program.programId, roundIndex, d.asset);
      tx.add(
        await program.methods
          .distributeTreasuryReward(roundIndex)
          .accountsStrict({
            authority: payer.publicKey,
            config: configKey,
            deskAsset: d.asset,
            deskTier: deskTierKey,
            tokenomics: tokenomicsKey,
            round: roundKey,
            treasuryState: treasuryKey,
            vault: vaultKey,
            hubMint,
            treasuryLockVault: tok.treasuryLockVault,
            ownerHub,
            tokenProgram: TOKEN_PROGRAM_ID,
            claim: claimKey,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .instruction(),
      );
      settled.push(d.asset.toBase58());
    }
    if (settled.length === 0) continue;
    try {
      const sig = await provider.sendAndConfirm(tx, [payer]);
      paid += settled.length;
      console.log(`  PAID ${settled.map((a) => a.slice(0, 6)).join(",")} → ${explorer(sig, "tx")}`);
    } catch (e) {
      failed += settled.length;
      console.error(`  FAILED [${settled.join(",")}]: ${(e as Error).message}`);
    }
    await sleep(250);
  }

  console.log(
    `\nround ${roundIndex} done: ${paid} paid · ${skipped} already paid · ${failed} failed (of ${active.length} active desks)`,
  );
  if (failed > 0) {
    console.log("re-run the same command to retry failures — already-paid desks are skipped.");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
