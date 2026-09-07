// Shared context for the devnet operator scripts (mint, mock desks). Signs with the devnet
// deployer (= Config.authority on devnet) and mirrors tests/harness.ts env conventions.
import "dotenv/config";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, type Umi } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { HUB_IDL, configPda, type HubProgram } from "../../sdk/src";

export type Ctx = {
  connection: Connection;
  provider: AnchorProvider;
  program: HubProgram;
  payer: Keypair;
  umi: Umi;
  config: PublicKey;
  rpc: string;
};

const expand = (p: string) => p.replace(/^~/, os.homedir());

export function devnetRpc(): string {
  // .env.example writes HUB_RPC_URL with a ${HELIUS_API_KEY} reference; dotenv does not expand it.
  const url = process.env.HUB_RPC_URL?.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] ?? "");
  if (url) return url;
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com";
}

/** Endpoint without query string — never print the raw RPC (it may carry an API key). */
export const redactRpc = (rpc: string) => rpc.split("?")[0];

export function loadKeypair(
  p = process.env.HUB_WALLET || "~/.config/solana/hubconnect-devnet.json",
) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expand(p), "utf8"))));
}

export async function devnetCtx(
  minSol = Number(process.env.HUB_DEVNET_MIN_SOL || 0.5),
): Promise<Ctx> {
  if ((process.env.HUB_CLUSTER || "devnet") !== "devnet") {
    throw new Error("these scripts are devnet-only (HUB_CLUSTER=devnet)");
  }
  const rpc = devnetRpc();
  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);
  const umi = createUmi(rpc, "confirmed").use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(payer)));

  const bal = (await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
  console.log(
    `rpc ${redactRpc(rpc)} · payer ${payer.publicKey.toBase58()} · ${bal.toFixed(3)} SOL`,
  );
  if (bal < minSol) {
    throw new Error(
      `payer below ${minSol} SOL; airdrop: solana airdrop 2 ${payer.publicKey.toBase58()} -u devnet`,
    );
  }
  const [config] = configPda(program.programId);
  return { connection, provider, program, payer, umi, config, rpc };
}

/** `update_config` for a Pubkey field; the payer must be Config.authority. */
export async function setConfigPubkey(
  ctx: Ctx,
  field: "opsWallet" | "deskCollection" | "hubMint" | "otcMint" | "otcDeskPot" | "otcProgram",
  value: PublicKey,
) {
  const cfg = await ctx.program.account.config.fetch(ctx.config);
  if (!cfg.authority.equals(ctx.payer.publicKey)) {
    throw new Error(`payer is not Config.authority (${cfg.authority.toBase58()})`);
  }
  if ((cfg[field] as PublicKey).equals(value)) {
    console.log(`config.${field} already ${value.toBase58()}`);
    return null;
  }
  const sig = await ctx.program.methods
    .updateConfig({ [field]: {} } as never, { pubkey: [value] })
    .accountsPartial({ authority: ctx.payer.publicKey, config: ctx.config })
    .rpc();
  console.log(`config.${field} → ${value.toBase58()}  (${sig})`);
  return sig;
}

export const explorer = (sigOrAddr: string, kind: "tx" | "address" = "address") =>
  `https://explorer.solana.com/${kind}/${sigOrAddr}?cluster=devnet`;
