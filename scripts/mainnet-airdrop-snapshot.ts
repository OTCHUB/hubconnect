// Mainnet genesis airdrop snapshot (§A7.1). Enumerates every OTC Desk NFT (Metaplex Core asset)
// in `Config.desk_collection` and its *current* owner via a direct RPC scan (`fetchDeskOwners` —
// no DAS/indexer dependency, so indexer lag or availability never affects who gets the airdrop),
// builds the uniform Merkle tree (10,000 $HUB / desk, capped at AIRDROP_DESK_CAP), and writes the
// tree + per-desk proofs to a JSON file for `mainnet-distribute.ts`.
//
// IMPORTANT — historical accuracy: standard Solana RPC (`getProgramAccounts`) can only read
// *current* on-chain state, not state "as of slot N". To snapshot at the exact mainnet block
// $HUB launched on, run this script as close to that block as possible — ideally immediately
// after it, before any desk changes hands. Pass --slot <N> (the launch block) to record/verify
// this; the script aborts if run too early and warns loudly if too much slot drift has passed.
//
// Don't have the launch slot memorized? Derive it exactly, after the fact, from chain history:
//   npx ts-node -T scripts/mainnet-hub-genesis-slot.ts --hub-mint <pubkey>
// which walks the $HUB mint's full signature history back to its InitializeMint tx and prints
// the slot to pass here — no need to be watching at the exact moment of launch.
//
//   npx ts-node -T scripts/mainnet-airdrop-snapshot.ts --slot 123456789 --out genesis-snapshot.json
//   npx ts-node -T scripts/mainnet-airdrop-snapshot.ts --slot 123456789 --tolerance 900
import "dotenv/config";
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  AIRDROP_DESK_CAP,
  AIRDROP_PER_DESK_UNITS,
  buildAirdropTree,
  configPda,
  createReader,
  fetchDeskOwners,
  type DeskOwnerEntry,
} from "../sdk/src";
import { mainnetRpc, parseFlags, redactRpc } from "./lib/mainnet";

function parseArgs() {
  const { get } = parseFlags(process.argv.slice(2));
  const slotRaw = get("--slot");
  return {
    slot: slotRaw ? Number(slotRaw) : null,
    // ~450 slots ≈ 3 minutes at Solana's ~400ms average slot time.
    tolerance: Number(get("--tolerance") ?? 450),
    out: get("--out") ?? "genesis-snapshot.json",
    rpc: get("--rpc") ?? null,
  };
}

/** Orders desks by parsed `#<n>` when known (mint-sequence proxy), else by pubkey — only matters
 * when the collection has grown past `AIRDROP_DESK_CAP` and a "first N" subset must be chosen. */
function orderForCap(owners: DeskOwnerEntry[]): DeskOwnerEntry[] {
  return [...owners].sort((a, b) => {
    if (a.deskNumber != null && b.deskNumber != null) return a.deskNumber - b.deskNumber;
    if (a.deskNumber != null) return -1;
    if (b.deskNumber != null) return 1;
    return a.asset.toBuffer().compare(b.asset.toBuffer());
  });
}

async function main() {
  const args = parseArgs();
  const rpc = mainnetRpc(args.rpc);
  const connection = new Connection(rpc, "confirmed");
  const program = createReader(connection);
  const [configKey] = configPda(program.programId);
  const cfg = await program.account.config.fetch(configKey);
  const collection = cfg.deskCollection as PublicKey;

  const currentSlot = await connection.getSlot("confirmed");
  console.log(`rpc ${redactRpc(rpc)} · program ${program.programId.toBase58()}`);
  console.log(`desk collection ${collection.toBase58()} · current slot ${currentSlot}`);

  if (args.slot != null) {
    if (currentSlot < args.slot) {
      throw new Error(
        `current slot ${currentSlot} is before the target genesis slot ${args.slot} — ` +
          `$HUB has not launched yet; wait and re-run`,
      );
    }
    const drift = currentSlot - args.slot;
    if (drift > args.tolerance) {
      console.warn(
        `⚠ WARNING: ${drift} slots (~${Math.round((drift * 0.4) / 60)} min) have passed since ` +
          `target slot ${args.slot}. A plain RPC can only read *current* state — any desk traded ` +
          `since block ${args.slot} will be credited to its NEW owner here, not the genesis ` +
          `holder. Re-run closer to the launch block for an exact snapshot, or reconcile trades ` +
          `manually before publishing this root.`,
      );
    } else {
      console.log(`slot drift ${drift} (within ${args.tolerance} tolerance) ✓`);
    }
  } else {
    console.warn(
      "⚠ no --slot given — this snapshot cannot be verified against the genesis block; pass " +
        "--slot <N> next time for an auditable record.",
    );
  }

  const owners = await fetchDeskOwners(connection, collection);
  if (owners.length === 0) throw new Error("no desk assets found in the collection");
  console.log(`found ${owners.length} desk asset(s)`);

  const unnumbered = owners.filter((o) => o.deskNumber === null).length;
  if (unnumbered > 0) {
    console.warn(
      `⚠ ${unnumbered}/${owners.length} desk name(s) did not match "#<n>" — falling back to ` +
        `pubkey order for those when choosing the capped "first N" subset.`,
    );
  }

  const capped = owners.length > AIRDROP_DESK_CAP;
  const ordered = orderForCap(owners);
  if (capped) {
    console.warn(
      `⚠ ${owners.length} desks exceed AIRDROP_DESK_CAP (${AIRDROP_DESK_CAP}) — only the first ` +
        `${AIRDROP_DESK_CAP} (by desk # where known) are eligible; verify the ordering matches ` +
        `policy before publishing this root.`,
    );
  }
  const eligible = ordered.slice(0, AIRDROP_DESK_CAP);

  const tree = await buildAirdropTree(
    eligible.map((e) => ({ asset: e.asset, amountUnits: AIRDROP_PER_DESK_UNITS })),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    programId: program.programId.toBase58(),
    deskCollection: collection.toBase58(),
    targetSlot: args.slot,
    snapshotSlot: currentSlot,
    perDeskUnits: AIRDROP_PER_DESK_UNITS.toString(),
    deskCount: eligible.length,
    totalDesksSeen: owners.length,
    capped,
    root: tree.rootHex,
    totalUnits: tree.totalUnits.toString(),
    entries: eligible.map((e) => ({
      asset: e.asset.toBase58(),
      owner: e.owner.toBase58(),
      deskNumber: e.deskNumber,
      amountUnits: AIRDROP_PER_DESK_UNITS.toString(),
      proof: tree.proofs.get(e.asset.toBase58())!.map((b) => Buffer.from(b).toString("hex")),
    })),
  };
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));

  console.log(`\nroot        ${tree.rootHex}`);
  console.log(`desk count  ${eligible.length} (of ${owners.length} seen)`);
  console.log(`total units ${tree.totalUnits} (${Number(tree.totalUnits) / 10 ** 6} $HUB)`);
  console.log(`written     → ${args.out}`);
  console.log(
    `\nnext: review ${args.out}, then run ` +
      `npx ts-node -T scripts/mainnet-distribute.ts --in ${args.out} --publish-root`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
