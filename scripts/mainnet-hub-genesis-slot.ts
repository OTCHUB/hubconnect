// Finds the exact mainnet-beta slot $HUB launched at — its mint account's *earliest* on-chain
// transaction (InitializeMint, sent by the OTC launcher, otcdesks.cash/launcher — external to
// this repo, see mainnet-init-config.ts). This is the canonical "$HUB genesis block": the desk
// airdrop (§A7.1) must snapshot desk ownership as of this exact slot, not whenever the operator
// happens to remember to run the snapshot script.
//
// Unlike noting the slot down live at launch time (error-prone, easy to be off by a few slots),
// this derives it *after the fact*, directly from chain history, so it is exact and reproducible
// by anyone — no manual bookkeeping, no reliance on being online at the right second.
//
// Paginates `getSignaturesForAddress` backwards (newest → oldest) until the RPC returns an empty
// page, i.e. there is nothing earlier — the last signature seen at that point is the mint's
// creation tx. Requires an RPC with full history for the mint account (Helius and other paid
// providers keep this; the public `api.mainnet-beta.solana.com` endpoint may not for older or
// high-traffic accounts — pass --rpc to point at a full-history provider if this looks truncated).
//
//   npx ts-node -T scripts/mainnet-hub-genesis-slot.ts --hub-mint <pubkey>
//   npx ts-node -T scripts/mainnet-hub-genesis-slot.ts --hub-mint <pubkey> --out mainnet-genesis-slot.json
//
// next: npx ts-node -T scripts/mainnet-airdrop-snapshot.ts --slot <slot from this script's output>
import "dotenv/config";
import fs from "node:fs";
import { Connection, type ConfirmedSignatureInfo, PublicKey } from "@solana/web3.js";
import { mainnetRpc, parseFlags, redactRpc, sleep } from "./lib/mainnet";

const PAGE_LIMIT = 1000;

/** Walks every signature for `address`, oldest last, via repeated `before`-cursor pagination.
 * Stops the instant a page comes back empty — that's proof there is nothing earlier. */
async function fetchAllSignatures(
  connection: Connection,
  address: PublicKey,
): Promise<ConfirmedSignatureInfo[]> {
  const all: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      address,
      { limit: PAGE_LIMIT, before },
      "confirmed",
    );
    if (page.length === 0) break;
    all.push(...page);
    process.stdout.write(`\r  scanned ${all.length} signature(s)...`);
    if (page.length < PAGE_LIMIT) break; // short page — reached the start of history
    before = page[page.length - 1].signature;
    await sleep(150); // stay well under RPC rate limits during a long walk
  }
  process.stdout.write("\n");
  return all;
}

function parseArgs() {
  const { get } = parseFlags(process.argv.slice(2));
  return {
    hubMint: get("--hub-mint"),
    out: get("--out") ?? "mainnet-genesis-slot.json",
    rpc: get("--rpc") ?? null,
  };
}

async function main() {
  const args = parseArgs();
  if (!args.hubMint) {
    throw new Error(
      "--hub-mint is required — the $HUB mint address minted by the OTC launcher on mainnet-beta",
    );
  }
  const hubMint = new PublicKey(args.hubMint);
  const rpc = mainnetRpc(args.rpc);
  const connection = new Connection(rpc, "confirmed");
  console.log(`rpc ${redactRpc(rpc)} · hub mint ${hubMint.toBase58()}`);

  const info = await connection.getAccountInfo(hubMint);
  if (!info) throw new Error(`${hubMint.toBase58()} does not exist on mainnet-beta`);

  console.log("walking full signature history back to genesis (this can take a while)...");
  const sigs = await fetchAllSignatures(connection, hubMint);
  if (sigs.length === 0) throw new Error("no transactions found for this mint — nothing to derive");

  const genesis = sigs[sigs.length - 1]; // oldest — the mint's InitializeMint tx
  if (genesis.err) {
    console.warn(
      `⚠ the earliest signature found (${genesis.signature}) recorded an on-chain error — this ` +
        "is unexpected for a mint's creation tx; verify manually before trusting this slot.",
    );
  }
  if (genesis.slot == null || genesis.blockTime == null) {
    throw new Error(
      `earliest signature ${genesis.signature} is missing slot/blockTime — RPC response incomplete`,
    );
  }

  const currentSlot = await connection.getSlot("confirmed");
  const out = {
    generatedAt: new Date().toISOString(),
    hubMint: hubMint.toBase58(),
    genesisSlot: genesis.slot,
    genesisSignature: genesis.signature,
    genesisBlockTime: new Date(genesis.blockTime * 1000).toISOString(),
    signaturesScanned: sigs.length,
    currentSlot,
  };
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));

  console.log(`\ngenesis slot   ${genesis.slot}`);
  console.log(`genesis tx     ${genesis.signature}`);
  console.log(`genesis time   ${out.genesisBlockTime}`);
  console.log(`signatures     ${sigs.length} scanned`);
  console.log(`written        → ${args.out}`);
  console.log(
    `\nnext: npx ts-node -T scripts/mainnet-airdrop-snapshot.ts --slot ${genesis.slot} --out genesis-snapshot.json`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
