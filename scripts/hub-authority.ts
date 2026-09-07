// Authority audit + $HUB mint-authority revocation + §A4.1 $OTC payment path admin.
//   npx ts-node -T scripts/hub-authority.ts status
//   npx ts-node -T scripts/hub-authority.ts revoke-mint --yes
//   npx ts-node -T scripts/hub-authority.ts otc-status
//   npx ts-node -T scripts/hub-authority.ts otc-init          # creates vault ATA for otc_mint + OtcPayConfig
//   npx ts-node -T scripts/hub-authority.ts otc-rate <otc_per_sol> [--enable|--disable]
//
// Two independent authorities, deliberately kept apart:
//   • Program upgrade authority (BPF loader ProgramData) — stays with the deployer/multisig so the
//     hub program remains upgradeable through Buffer → `solana program deploy`/`write-buffer`.
//   • $HUB SPL mint authority — revoked (set to None) so supply is immutable, matching what
//     pump.fun / the OTC launcher do at graduation. The hub program never mints; it only reads
//     Config.hub_mint and books burns, so revoking has no effect on protocol operation.
// `revoke-mint` is irreversible; it refuses to run without --yes and re-checks the mint first.
import "dotenv/config";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { Connection } from "@solana/web3.js";
import {
  HUB_IDL,
  OTC_RATE_MAX_AGE_SECS,
  configPda,
  otcFeeUnits,
  otcPayPda,
  treasuryPda,
  vaultPda,
  type HubProgram,
} from "../sdk/src";
import { STEP_FEE_LAMPORTS } from "../sdk/src/constants";
import {
  ata,
  createAtaIdempotent,
  devnetRpc,
  explorer,
  loadKeypair,
  redactRpc,
} from "./lib/devnet";
import { TOKEN_PROGRAM_ID } from "./devnet-hub-mint";

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

type MintInfo = {
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  supply: bigint;
  decimals: number;
};

/** spl-token Mint layout (82 bytes): COption<Pubkey> mint_auth · u64 supply · u8 decimals · bool · COption<Pubkey> freeze. */
function parseMint(data: Buffer): MintInfo {
  const opt = (off: number) =>
    data.readUInt32LE(off) === 1 ? new PublicKey(data.subarray(off + 4, off + 36)) : null;
  return {
    mintAuthority: opt(0),
    supply: data.readBigUInt64LE(36),
    decimals: data[44],
    freezeAuthority: opt(46),
  };
}

/** spl-token `SetAuthority` (ix 6): authority_type 0 = MintTokens, 1 = FreezeAccount; new = None. */
function revokeAuthorityIx(mint: PublicKey, current: PublicKey, authorityType: 0 | 1) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: current, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([6, authorityType, 0]),
  });
}

async function upgradeAuthority(connection: Connection, programId: PublicKey) {
  const prog = await connection.getAccountInfo(programId);
  if (!prog || !prog.owner.equals(BPF_UPGRADEABLE_LOADER))
    return { programData: null, authority: null };
  const programData = new PublicKey(prog.data.subarray(4, 36));
  const pd = await connection.getAccountInfo(programData);
  if (!pd) return { programData, authority: null };
  // ProgramData: u32 tag(3) · u64 slot · Option<Pubkey> upgrade_authority (1 + 32)
  const has = pd.data[12] === 1;
  return {
    programData,
    slot: Number(pd.data.readBigUInt64LE(4)),
    authority: has ? new PublicKey(pd.data.subarray(13, 45)) : null,
    size: pd.data.length,
  };
}

/** `otc-status` / `otc-init` / `otc-rate` — the §A4.1 path is a separate PDA, created after init. */
async function otcPayCommand(
  cmd: string,
  program: HubProgram,
  connection: Connection,
  payer: ReturnType<typeof loadKeypair>,
  cfg: Awaited<ReturnType<HubProgram["account"]["config"]["fetch"]>>,
) {
  const id = program.programId;
  const [otcPayKey] = otcPayPda(id);
  const [vault] = vaultPda(id);
  const polAccount = ata(vault, cfg.otcMint);
  const existing = await program.account.otcPayConfig.fetchNullable(otcPayKey);
  const stepSol = STEP_FEE_LAMPORTS / 1e9;

  if (cmd === "otc-status") {
    console.log(`$OTC payment path (OtcPayConfig ${otcPayKey.toBase58()})`);
    console.log(`  config.otc_mint   : ${cfg.otcMint.toBase58()}`);
    console.log(
      `  POL reserve (ATA) : ${polAccount.toBase58()} (owner = vault ${vault.toBase58()})`,
    );
    if (!existing) {
      console.log("  state             : NOT INITIALIZED — run otc-init");
      return;
    }
    const age = Math.floor(Date.now() / 1000) - existing.rateTs.toNumber();
    const stale = age > OTC_RATE_MAX_AGE_SECS;
    console.log(`  enabled           : ${existing.enabled}`);
    console.log(
      `  otc_per_sol       : ${existing.otcPerSol.toString()} units/SOL · set ${age}s ago${stale ? "  ⚠ STALE (path rejects)" : ""}`,
    );
    console.log(`  premium           : ${existing.premiumBp / 100}%`);
    console.log(
      `  step price        : ${stepSol} SOL  or  ${otcFeeUnits(STEP_FEE_LAMPORTS, BigInt(existing.otcPerSol.toString()), existing.premiumBp).toString()} OTC units`,
    );
    console.log(`  collected for POL : ${existing.totalOtcCollected.toString()} units`);
    return;
  }

  if (cmd === "otc-init") {
    if (existing) throw new Error(`OtcPayConfig already exists at ${otcPayKey.toBase58()}`);
    const mintInfo = await connection.getAccountInfo(cfg.otcMint);
    if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID))
      throw new Error(`config.otc_mint ${cfg.otcMint.toBase58()} is not an SPL Token mint`);
    const sig = await program.methods
      .initOtcPayments()
      .accountsStrict({
        authority: payer.publicKey,
        config: configPda(id)[0],
        treasuryState: treasuryPda(id)[0],
        vault,
        polAccount,
        otcPay: otcPayKey,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .preInstructions([createAtaIdempotent(payer.publicKey, vault, cfg.otcMint)])
      .rpc();
    console.log(`OtcPayConfig created (disabled, unpriced) → ${explorer(sig, "tx")}`);
    console.log(`  POL reserve ${polAccount.toBase58()} · next: otc-rate <otc_per_sol> --enable`);
    return;
  }

  if (cmd === "otc-rate") {
    if (!existing) throw new Error("run otc-init first");
    const raw = process.argv[3];
    if (!raw || !/^\d+$/.test(raw))
      throw new Error("usage: otc-rate <otc_per_sol units> [--enable|--disable]");
    const otcPerSol = BigInt(raw);
    const enabled = process.argv.includes("--disable")
      ? false
      : process.argv.includes("--enable")
        ? true
        : existing.enabled;
    const sig = await program.methods
      .setOtcRate(new BN(otcPerSol.toString()), enabled)
      .accountsStrict({ authority: payer.publicKey, config: configPda(id)[0], otcPay: otcPayKey })
      .rpc();
    console.log(
      `otc_per_sol = ${otcPerSol} · enabled = ${enabled} · step = ${otcFeeUnits(STEP_FEE_LAMPORTS, otcPerSol, existing.premiumBp)} OTC units → ${explorer(sig, "tx")}`,
    );
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

async function main() {
  const cmd = process.argv[2] ?? "status";
  const rpc = devnetRpc();
  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
  const program: HubProgram = new Program(HUB_IDL, provider);
  const [configKey] = configPda(program.programId);
  const cfg = await program.account.config.fetch(configKey);
  console.log(`rpc ${redactRpc(rpc)} · signer ${payer.publicKey.toBase58()}`);
  if (cmd.startsWith("otc-")) return otcPayCommand(cmd, program, connection, payer, cfg);

  const up = await upgradeAuthority(connection, program.programId);
  console.log(`program ${program.programId.toBase58()}`);
  console.log(
    `  upgrade authority : ${up.authority ? up.authority.toBase58() : "NONE (immutable)"}` +
      (up.authority?.equals(payer.publicKey) ? "  ← signer" : ""),
  );
  console.log(
    `  programdata       : ${up.programData?.toBase58()} · ${up.size} bytes · deployed slot ${up.slot}`,
  );
  console.log(`  config.authority  : ${cfg.authority.toBase58()} (update_config / pause signer)`);
  console.log(
    `  config.treasury   : ${cfg.treasury.toBase58()} (register_*_inflow / build_lp signer)`,
  );

  const mintInfo = await connection.getAccountInfo(cfg.hubMint);
  if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`config.hub_mint ${cfg.hubMint.toBase58()} is not an SPL Token mint`);
  }
  const mint = parseMint(mintInfo.data);
  console.log(`$HUB mint ${cfg.hubMint.toBase58()}`);
  console.log(`  supply            : ${mint.supply} (10^${mint.decimals})`);
  console.log(
    `  mint authority    : ${mint.mintAuthority ? mint.mintAuthority.toBase58() + "  ⚠ supply NOT immutable" : "NONE — supply immutable ✓"}`,
  );
  console.log(
    `  freeze authority  : ${mint.freezeAuthority ? mint.freezeAuthority.toBase58() : "NONE ✓"}`,
  );

  if (cmd === "status") return;
  if (cmd !== "revoke-mint") throw new Error(`unknown command ${cmd}`);
  if (!mint.mintAuthority && !mint.freezeAuthority) {
    console.log("nothing to revoke");
    return;
  }
  if (!process.argv.includes("--yes")) {
    throw new Error("revoke-mint is irreversible: re-run with --yes");
  }
  const ixs: TransactionInstruction[] = [];
  for (const [auth, type] of [
    [mint.mintAuthority, 0],
    [mint.freezeAuthority, 1],
  ] as const) {
    if (!auth) continue;
    if (!auth.equals(payer.publicKey)) {
      throw new Error(
        `signer is not the ${type === 0 ? "mint" : "freeze"} authority (${auth.toBase58()})`,
      );
    }
    ixs.push(revokeAuthorityIx(cfg.hubMint, payer.publicKey, type));
  }
  const sig = await provider.sendAndConfirm(new Transaction().add(...ixs), [payer]);
  console.log(`revoked → ${explorer(sig, "tx")}`);
  const after = parseMint((await connection.getAccountInfo(cfg.hubMint))!.data);
  console.log(
    `  mint authority now ${after.mintAuthority ? after.mintAuthority.toBase58() : "NONE ✓"} · freeze ${after.freezeAuthority ? after.freezeAuthority.toBase58() : "NONE ✓"}`,
  );
  // The program is untouched: still upgradeable by its ProgramData authority.
  const up2 = await upgradeAuthority(connection, program.programId);
  console.log(`  program upgrade authority unchanged: ${up2.authority?.toBase58()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
