// Attach Metaplex Token Metadata (name / symbol / logo URI) to the mainnet-beta $HUB mint so
// wallets and explorers render the token instead of "Unknown". Mainnet counterpart of
// devnet-hub-metadata.ts — deliberately separate (uses lib/mainnet.ts, HUB_MAINNET_WALLET, no
// devnet-style default keypair path) so a missing env var fails loudly instead of guessing.
//   npx ts-node -T scripts/mainnet-hub-metadata.ts --uri <permanent-json-url> [--name "HUB Protocol"] [--symbol HUB]
// Idempotent: creates the metadata account if missing, otherwise updates it. The signer must be
// Config.authority (mint authority) to create, or the metadata update authority to update. The
// --uri must point to a permanently-hosted JSON document (Arweave/IPFS) whose `image` field is
// the permanently-hosted logo PNG — see assets/hub-token.json.
import "dotenv/config";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { HUB_IDL, configPda, type HubProgram } from "../sdk/src";
import { loadMainnetKeypair, mainnetRpc, redactRpc, TOKEN_PROGRAM_ID } from "./lib/mainnet";
import { createMetadataV3, metadataPda, updateMetadataV2 } from "./devnet-hub-metadata";

const MINT_SIZE = 82;

function arg(name: string, dflt?: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const rpc = mainnetRpc(arg("--rpc", null as unknown as string));
  const connection = new Connection(rpc, "confirmed");
  const payer = loadMainnetKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);

  const name = arg("--name", "HUB Protocol")!;
  const symbol = arg("--symbol", "HUB")!;
  const uri = arg("--uri");
  if (!uri) throw new Error("--uri is required — pass the permanently-hosted metadata JSON URL");

  console.log(
    `rpc ${redactRpc(rpc)} · authority ${payer.publicKey.toBase58()} · program ${program.programId.toBase58()}`,
  );

  const [configKey] = configPda(program.programId);
  const cfg = await program.account.config.fetch(configKey);
  const mint: PublicKey = cfg.hubMint as PublicKey;
  const info = await connection.getAccountInfo(mint);
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== MINT_SIZE) {
    throw new Error(`Config.hub_mint ${mint.toBase58()} is not a Token-program mint`);
  }
  const mintAuthority = new PublicKey(info.data.subarray(4, 36));

  const pda = metadataPda(mint);
  const exists = !!(await connection.getAccountInfo(pda));
  if (exists) {
    // Update path checks the on-chain update authority, not the mint authority.
  } else if (!mintAuthority.equals(payer.publicKey)) {
    throw new Error(`signer is not the mint authority (${mintAuthority.toBase58()})`);
  }

  const ix = exists
    ? updateMetadataV2(mint, payer.publicKey, name, symbol, uri)
    : createMetadataV3(mint, payer.publicKey, name, symbol, uri);

  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });

  console.log(
    `${exists ? "updated" : "created"} metadata ${pda.toBase58()} for $HUB ${mint.toBase58()}`,
  );
  console.log(
    `  name=${name} symbol=${symbol}\n  uri=${uri}\n  https://explorer.solana.com/tx/${sig}`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
