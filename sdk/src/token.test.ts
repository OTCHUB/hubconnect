import { expect } from "chai";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { ataPda } from "./pda";
import { fetchHubTokenState } from "./token";

/** Minimal 165 B spl-token Account layout: mint(32) · owner(32) · u64 amount @ offset 64 · … */
function tokenAccountInfo(units: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(units, 64);
  return { data, executable: false, lamports: 0, owner: PublicKey.default, rentEpoch: 0 };
}

/** Look up a pubkey's canned AccountInfo by base58 key, `null` if not present (uninitialized). */
function mockConnection(byKey: Map<string, AccountInfo<Buffer>>): Connection {
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[]) =>
      keys.map((k) => byKey.get(k.toBase58()) ?? null),
  } as unknown as Connection;
}

describe("sdk/token fetchHubTokenState — owner-vs-direct-account branching", () => {
  const hubMint = Keypair.generate().publicKey;

  it("derives the standard ATA for `lockedOwners` (wallet/PDA authorities)", async () => {
    const multisig = Keypair.generate().publicKey;
    const [expectedAta] = ataPda(multisig, hubMint);
    const byKey = new Map([[expectedAta.toBase58(), tokenAccountInfo(500n)]]);

    const state = await fetchHubTokenState(mockConnection(byKey), hubMint, [multisig], []);

    expect(state.holdings).to.have.length(1);
    expect(state.holdings[0].owner).to.equal(multisig.toBase58());
    expect(state.holdings[0].ata).to.equal(expectedAta.toBase58());
    expect(state.holdings[0].units).to.equal(500n);
    expect(state.lockedUnits).to.equal(500n);
  });

  it("reads `lockedTokenAccounts` directly, with NO ATA derivation", async () => {
    // e.g. TokenomicsConfig.treasuryLockVault / airdropVault — PDA-owned vaults whose own
    // address *is* the token account, not a wallet whose ATA must be computed. Deriving an ATA
    // for these would silently resolve to a different, empty account (the original bug).
    const treasuryLockVault = Keypair.generate().publicKey;
    const [wrongAta] = ataPda(treasuryLockVault, hubMint);
    const byKey = new Map([
      [treasuryLockVault.toBase58(), tokenAccountInfo(777n)],
      [wrongAta.toBase58(), tokenAccountInfo(999999n)], // must NOT be the one read
    ]);

    const state = await fetchHubTokenState(mockConnection(byKey), hubMint, [], [
      treasuryLockVault,
    ]);

    expect(state.holdings).to.have.length(1);
    expect(state.holdings[0].owner).to.equal(treasuryLockVault.toBase58());
    expect(state.holdings[0].ata).to.equal(treasuryLockVault.toBase58());
    expect(state.holdings[0].units).to.equal(777n);
    expect(state.lockedUnits).to.equal(777n);
  });

  it("sums both groups correctly when mixed, preserving per-entry identity", async () => {
    const multisig = Keypair.generate().publicKey;
    const vaultAuthority = Keypair.generate().publicKey;
    const treasuryLockVault = Keypair.generate().publicKey;
    const airdropVault = Keypair.generate().publicKey;
    const [multisigAta] = ataPda(multisig, hubMint);
    const [vaultAta] = ataPda(vaultAuthority, hubMint);
    const byKey = new Map([
      [multisigAta.toBase58(), tokenAccountInfo(100n)],
      [vaultAta.toBase58(), tokenAccountInfo(200n)],
      [treasuryLockVault.toBase58(), tokenAccountInfo(300n)],
      [airdropVault.toBase58(), tokenAccountInfo(400n)],
    ]);

    const state = await fetchHubTokenState(
      mockConnection(byKey),
      hubMint,
      [multisig, vaultAuthority],
      [treasuryLockVault, airdropVault],
    );

    expect(state.holdings.map((h) => h.units)).to.deep.equal([100n, 200n, 300n, 400n]);
    expect(state.holdings[0].ata).to.equal(multisigAta.toBase58());
    expect(state.holdings[1].ata).to.equal(vaultAta.toBase58());
    expect(state.holdings[2].ata).to.equal(treasuryLockVault.toBase58());
    expect(state.holdings[3].ata).to.equal(airdropVault.toBase58());
    expect(state.lockedUnits).to.equal(1000n);
  });

  it("treats a missing (uninitialized) account as 0 units instead of throwing", async () => {
    const airdropVault = Keypair.generate().publicKey; // no entry in byKey → getAccountInfo → null
    const state = await fetchHubTokenState(mockConnection(new Map()), hubMint, [], [
      airdropVault,
    ]);

    expect(state.mint).to.equal(null);
    expect(state.metadata).to.equal(null);
    expect(state.holdings[0].units).to.equal(0n);
    expect(state.lockedUnits).to.equal(0n);
  });
});
