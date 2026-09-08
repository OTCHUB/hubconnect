// M.I.M ETF claim portal (§A5.1): `claim_hub_pot_reward` lets a desk's current owner pull their
// own tier-weighted share of the $OTC/CRCLx/OpenAI/Anthropic basket for one open `HubPotRound`,
// self-signed and self-funded (tx fee + any missing bucket ATA rent + the `HubPotClaim` receipt
// rent) — the pull counterpart to the authority-pushed `distribute_hub_pot_reward`, sharing the
// same `HubPotClaim` PDA so a desk is paid at most once per round regardless of path. Same
// reliability model as `lib/claim.ts`'s `executeClaimYield`: every tx is simulated unsigned
// first, one wallet prompt signs the whole passing batch.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ataPda,
  configPda,
  createAtaIdempotentIx,
  hubPotClaimPda,
  hubPotPda,
  hubPotRoundPda,
  tierPda,
  treasuryPda,
  vaultPda,
  TOKEN_PROGRAM_ID,
  type HubPotView,
  type HubProgram,
} from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type HubPotClaimPhase = "build" | "sim" | "sign" | "send" | "confirm";
export type HubPotClaimResult = { asset: string; ok: boolean; sig?: string; reason?: string };

const CU_LIMIT = 400_000;
const CU_PRICE_MICRO = 10_000;
/** Each ix touches ~20 accounts (4 mints/vaults/claimant ATAs) — keep 1 per tx for message size. */
const MAX_IXS_PER_TX = 1;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

const BUCKET_MINTS = (pot: HubPotView) =>
  [pot.otcMint, pot.crclxMint, pot.openaiMint, pot.anthropicMint].map((m) => new PublicKey(m));

/** Unsigned `claim_hub_pot_reward` instruction for one desk asset, one round. */
export async function buildClaimHubPotRewardIx(
  program: HubProgram,
  claimant: PublicKey,
  deskAsset: PublicKey,
  roundIndex: number,
  pot: HubPotView,
): Promise<TransactionInstruction> {
  const id = program.programId;
  const [otcMint, crclxMint, openaiMint, anthropicMint] = BUCKET_MINTS(pot);
  return program.methods
    .claimHubPotReward(roundIndex)
    .accountsStrict({
      claimant,
      config: configPda(id)[0],
      deskAsset,
      deskTier: tierPda(id, deskAsset)[0],
      hubPot: hubPotPda(id)[0],
      round: hubPotRoundPda(id, roundIndex)[0],
      treasuryState: treasuryPda(id)[0],
      vault: vaultPda(id)[0],
      otcMint,
      crclxMint,
      openaiMint,
      anthropicMint,
      otcVault: new PublicKey(pot.otcVault),
      crclxVault: new PublicKey(pot.crclxVault),
      openaiVault: new PublicKey(pot.openaiVault),
      anthropicVault: new PublicKey(pot.anthropicVault),
      claimantOtc: ataPda(claimant, otcMint)[0],
      claimantCrclx: ataPda(claimant, crclxMint)[0],
      claimantOpenai: ataPda(claimant, openaiMint)[0],
      claimantAnthropic: ataPda(claimant, anthropicMint)[0],
      tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
      claim: hubPotClaimPda(id, roundIndex, deskAsset)[0],
      systemProgram: SYSTEM_PROGRAM,
    })
    .instruction();
}

/**
 * Claims the M.I.M ETF basket for `assets` against `roundIndex` (one ix per desk, 1 per tx — the
 * account list is too wide to safely pack more per tx). Creates any of the claimant's 4 bucket
 * ATAs that don't exist yet (idempotent, riding in the first tx) before the claim ixs. Sim → one
 * signAll prompt → send → confirm, same as `executeClaimYield`.
 */
export async function executeClaimHubPotReward(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  assets: string[];
  roundIndex: number;
  pot: HubPotView;
  onLog: (l: TxLog) => void;
  onPhase?: (p: HubPotClaimPhase) => void;
}): Promise<HubPotClaimResult[]> {
  const { connection, program, signer, assets, roundIndex, pot, onLog, onPhase } = opts;
  const claimant = new PublicKey(signer.publicKey);
  const results: HubPotClaimResult[] = [];
  if (!assets.length) return results;

  onPhase?.("build");
  const mints = BUCKET_MINTS(pot);
  const atas = mints.map((m) => ataPda(claimant, m)[0]);
  const ataInfos = await connection.getMultipleAccountsInfo(atas, "confirmed");
  const preamble = mints
    .filter((_, i) => !ataInfos[i])
    .map((m) => createAtaIdempotentIx(claimant, claimant, m));

  const ixs = await Promise.all(
    assets.map((a) =>
      buildClaimHubPotRewardIx(program, claimant, new PublicKey(a), roundIndex, pot),
    ),
  );
  const bh = await connection.getLatestBlockhash("confirmed");
  const txs = assets.map((_, i) => {
    const tx = new Transaction({ feePayer: claimant, recentBlockhash: bh.blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
      ...(i === 0 ? preamble : []),
      ixs[i],
    );
    return tx;
  });
  onLog({ type: "info", msg: `CLAIM :: ${assets.length} desk(s) in ${txs.length} tx(s)` });

  onPhase?.("sim");
  const sims = await Promise.all(
    txs.map((tx) => connection.simulateTransaction(tx, undefined, false)),
  );
  const passing: { tx: Transaction; i: number }[] = [];
  sims.forEach((s, i) => {
    if (s.value.err) {
      const line = s.value.logs?.find((l) => /Error Message|Error Code/.test(l));
      const reason = line?.replace("Program log: ", "") ?? JSON.stringify(s.value.err);
      onLog({ type: "err", msg: `TX ${i + 1} SIM_FAIL: ${reason}` });
      results.push({ asset: assets[i], ok: false, reason });
    } else {
      onLog({ type: "sim", msg: `TX ${i + 1} sim OK (${s.value.unitsConsumed ?? "?"} CU)` });
      passing.push({ tx: txs[i], i });
    }
  });
  if (!passing.length) {
    onLog({ type: "err", msg: "All simulations failed — nothing to sign." });
    return results;
  }

  onPhase?.("sign");
  onLog({ type: "info", msg: `SIGN :: 1 prompt for ${passing.length} tx(s)…` });
  let signed: Uint8Array[];
  try {
    signed = await signer.signAllTransactionsRaw(passing.map((p) => p.tx));
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${(e as Error).message}` });
    passing.forEach((p) => results.push({ asset: assets[p.i], ok: false, reason: "rejected" }));
    return results;
  }

  onPhase?.("send");
  const sent = await Promise.all(
    signed.map(async (bytes, k) => {
      try {
        const sig = await connection.sendRawTransaction(bytes, {
          skipPreflight: true,
          maxRetries: 3,
        });
        onLog({ type: "ok", msg: `TX ${passing[k].i + 1} SENT ${sig.slice(0, 8)}…`, sig });
        return { k, sig };
      } catch (e) {
        const reason = (e as Error).message;
        onLog({ type: "err", msg: `TX ${passing[k].i + 1} SEND_FAIL: ${reason}` });
        results.push({ asset: assets[passing[k].i], ok: false, reason });
        return null;
      }
    }),
  );

  onPhase?.("confirm");
  await Promise.all(
    sent.map(async (s) => {
      if (!s) return;
      const conf = await connection.confirmTransaction({ signature: s.sig, ...bh }, "confirmed");
      const err = conf.value.err ? JSON.stringify(conf.value.err) : undefined;
      if (err)
        onLog({ type: "err", msg: `TX ${passing[s.k].i + 1} FAILED_ON_CHAIN: ${err}`, sig: s.sig });
      results.push({ asset: assets[passing[s.k].i], ok: !err, sig: s.sig, reason: err });
    }),
  );
  const ok = results.filter((r) => r.ok).length;
  onLog({
    type: ok === results.length ? "ok" : "err",
    msg: `DONE :: ${ok}/${results.length} desk(s) claimed`,
  });
  return results;
}
