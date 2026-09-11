// Shared "$HUB mint sealed" check — every keeper's operational gate needs it (see
// `./gate.ts`'s `hubMintSealed` input). Extracted from `keeper/keeper/src/index.ts` so all
// five services read the exact same on-chain check instead of five copies drifting apart.
import { Connection, PublicKey } from "@solana/web3.js";

/** spl-token `Mint` layout: `COption<Pubkey>` mint authority at offset 0 (4-byte tag + 32 bytes).
 *  Sealed ⇔ tag == 0 (`None`) — mirrors `scripts/hub-authority.ts`'s `parseMint`. */
export async function isMintAuthoritySealed(
  connection: Connection,
  mint: PublicKey,
): Promise<boolean> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`$HUB mint ${mint.toBase58()} not found on this cluster`);
  return info.data.readUInt32LE(0) !== 1;
}
