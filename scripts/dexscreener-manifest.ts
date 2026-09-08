// DexScreener "Enhanced Token Info" submission manifest — read-only, no wallet/signer needed
// (same createReader pattern as hub-snapshot-ingest.ts). Writes manifest.json with the address
// list + supply facts a DexScreener reviewer verifies on-chain, plus the M.I.M ETF / MemeStock
// Basket reserve addresses as their own section.
//
//   HUB_CLUSTER=mainnet-beta npx ts-node -T scripts/dexscreener-manifest.ts   # default cluster
//   HUB_CLUSTER=devnet npx ts-node -T scripts/dexscreener-manifest.ts --out manifest.devnet.json
//
// Deliberately does NOT fold HubPotConfig vault balances into $HUB's `supply.locked`/`circulating`
// figures: those vaults hold OTC/CRCLx/OPENAI/ANTHROPIC — a different set of mints, not $HUB — so
// summing them into $HUB's supply math would misstate the very numbers a DexScreener reviewer is
// there to check. dexscreenerTokenInfo() already computes correct $HUB-only locked/circulating
// from Program-owned $HUB holdings; the basket vaults are reported separately below instead.
import "dotenv/config";
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  AIRDROP_DESK_CAP,
  burnPda,
  createReader,
  dexscreenerTokenInfo,
  fetchHubPot,
  fetchProtocolState,
  fetchTokenomics,
  tokenomicsPlan,
} from "../sdk/src";
import { devnetRpc } from "./lib/devnet";
import { mainnetRpc, redactRpc } from "./lib/mainnet";

const cluster = process.env.HUB_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";

/** Reads just the `decimals` byte (offset 44) of an spl-token Mint account — same layout as the
 *  parser in scripts/hub-authority.ts, kept minimal since only decimals are needed here. */
async function mintDecimals(connection: Connection, mint: string): Promise<number | null> {
  const info = await connection.getAccountInfo(new PublicKey(mint));
  return info ? info.data[44] : null;
}

const whole = (units: bigint, decimals: number) => (Number(units) / 10 ** decimals).toString();

async function main() {
  const outPath = (() => {
    const i = process.argv.indexOf("--out");
    return i >= 0 ? process.argv[i + 1] : "manifest.json";
  })();

  const rpc = cluster === "devnet" ? devnetRpc() : mainnetRpc();
  console.info(`[manifest] cluster=${cluster} rpc=${redactRpc(rpc)}`);
  const connection = new Connection(rpc, "confirmed");
  const program = createReader(connection);
  const programId = program.programId;

  const [state, tokenomics, hubPot] = await Promise.all([
    fetchProtocolState(program),
    fetchTokenomics(program),
    fetchHubPot(program),
  ]);

  const deskCount =
    tokenomics && tokenomics.snapshotDeskCount > 0
      ? tokenomics.snapshotDeskCount
      : AIRDROP_DESK_CAP;
  const plan = tokenomicsPlan(deskCount, {
    maxUnits: tokenomics?.maxSupplyUnits,
    airdropPerDeskUnits: tokenomics?.airdropPerDeskUnits,
    treasuryLockBp: tokenomics?.treasuryLockBp,
    teamBp: tokenomics?.teamBp,
  });
  const hubToken = dexscreenerTokenInfo({
    state,
    tokenomics,
    plan,
    burnPda: burnPda(programId)[0].toBase58(),
  });

  let basket: Record<string, unknown> | null = null;
  if (hubPot) {
    const buckets = [
      {
        id: "otc",
        label: "$OTC",
        mint: hubPot.otcMint,
        vault: hubPot.otcVault,
        pending: hubPot.otcPendingUnits,
        deposited: hubPot.otcDepositedUnits,
      },
      {
        id: "crclx",
        label: "CRCLx",
        mint: hubPot.crclxMint,
        vault: hubPot.crclxVault,
        pending: hubPot.crclxPendingUnits,
        deposited: hubPot.crclxDepositedUnits,
      },
      {
        id: "openai",
        label: "OPENAI",
        mint: hubPot.openaiMint,
        vault: hubPot.openaiVault,
        pending: hubPot.openaiPendingUnits,
        deposited: hubPot.openaiDepositedUnits,
      },
      {
        id: "anthropic",
        label: "ANTHROPIC",
        mint: hubPot.anthropicMint,
        vault: hubPot.anthropicVault,
        pending: hubPot.anthropicPendingUnits,
        deposited: hubPot.anthropicDepositedUnits,
      },
    ];
    const decimals = await Promise.all(buckets.map((b) => mintDecimals(connection, b.mint)));
    basket = {
      note: "M.I.M ETF / MemeStock Basket reserves — separate from $HUB supply above; these vaults hold OTC/CRCLx/OPENAI/ANTHROPIC, not $HUB.",
      roundCount: hubPot.roundCount,
      buckets: buckets.map((b, idx) => ({
        id: b.id,
        label: b.label,
        mint: b.mint,
        vault: b.vault,
        decimals: decimals[idx],
        pending: decimals[idx] != null ? whole(b.pending, decimals[idx]!) : b.pending.toString(),
        lifetimeDeposited:
          decimals[idx] != null ? whole(b.deposited, decimals[idx]!) : b.deposited.toString(),
      })),
    };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    cluster,
    hubProgramId: programId.toBase58(),
    hubMint: state.config.hubMint,
    treasuryVault: state.config.treasury,
    hubToken,
    memeStockBasket: basket,
  };

  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.info(`[manifest] wrote ${outPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
