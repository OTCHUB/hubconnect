// Shared test harness. Runs against `anchor test` localnet by default; set
// HUB_CLUSTER=devnet to target Helius devnet with the §B5.1 funder guard.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import type { Hub } from "../target/types/hub";

export type Harness = {
  provider: anchor.AnchorProvider;
  program: Program<Hub>;
  payer: Keypair;
  cluster: "localnet" | "devnet";
};

const expand = (p: string) => p.replace(/^~/, os.homedir());

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(expand(p), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function devnetRpc(): string {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com";
}

export async function setup(): Promise<Harness> {
  const cluster = (process.env.HUB_CLUSTER as Harness["cluster"]) || "localnet";
  let provider: anchor.AnchorProvider;

  if (cluster === "devnet") {
    const walletPath = process.env.HUB_WALLET || "~/.config/solana/hubconnect-devnet.json";
    const payer = loadKeypair(walletPath);
    const connection = new Connection(devnetRpc(), "confirmed");
    provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);
    await funderGuard(connection, payer.publicKey);
  } else {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
  }

  const program = anchor.workspace.Hub as Program<Hub>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  return { provider, program, payer, cluster };
}

/** §B5.1 — abort loudly instead of silently failing mid-suite on an empty funder. */
async function funderGuard(connection: Connection, funder: PublicKey) {
  const min = Number(process.env.HUB_DEVNET_MIN_SOL || 2);
  const bal = (await connection.getBalance(funder)) / LAMPORTS_PER_SOL;
  if (bal < min) {
    throw new Error(
      `devnet funder ${funder.toBase58()} has ${bal.toFixed(3)} SOL < ${min} SOL; ` +
        `airdrop first: solana airdrop 2 ${funder.toBase58()} -u devnet`,
    );
  }
}
