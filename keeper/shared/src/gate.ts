// Shared keeper "may I auto-operate right now" gate. This is the switch behind
// "give the keeper permission to run automatically once the protocol has started and
// $HUB mint is sealed" — two conditions, both checked fresh every cycle (never cached
// past a single run):
//
//   1. `Config.paused == false` — the on-chain authority-controlled kill switch
//      (`set_paused`, §B3 #10). Read live; if the authority pauses mid-run, the very
//      next cycle refuses to start.
//   2. `$HUB` mint authority has been revoked ("mint sealed") — there is no on-chain
//      Config field for this (mint authority lives on the SPL mint account itself, not
//      in `Config`), so the caller resolves it once via `getMint(hubMint).mintAuthority
//      === null` and passes the boolean in. Before that revocation, autonomous keeper
//      spend against a still-mintable $HUB supply is refused — new supply could dilute
//      every in-flight swap/burn/LP decision the keeper makes.
//
// Pure decision logic only — no RPC/signing. Mirrors `gas.ts` / `sweeper/src/arbitrage.ts`.
//
// NOTE — this gate does not, by itself, grant a keeper the ability to move treasury
// funds. Several instructions it calls (`register_treasury_inflow`, `record_creator_fee`,
// `build_lp`, `build_lp_otc_locked`) require the transaction signer to literally be
// `Config.treasury` (`has_one = treasury`). Passing this gate only means the keeper
// *should* attempt a cycle; whether it *can* still depends on the operator having handed
// the keeper process a key authorized to sign as `Config.treasury` — a key-custody
// decision made outside this program, not something any gate flag can express.

export type ConfigPauseSnapshot = {
  paused: boolean;
};

export type OperationalGateInputs = {
  config: ConfigPauseSnapshot;
  /** Resolved off-chain via `getMint(hubMint).mintAuthority === null`. */
  hubMintSealed: boolean;
};

export type OperationalGateResult = { ok: true } | { ok: false; reason: string };

/** Pre-flight gate for any keeper cycle, independent of and in addition to
 *  `checkGasFloat`. Both must pass before a keeper attempts on-chain work. */
export function checkOperationalGate(inputs: OperationalGateInputs): OperationalGateResult {
  if (inputs.config.paused) {
    return {
      ok: false,
      reason: "Config.paused = true — protocol halted by authority, refusing to run",
    };
  }
  if (!inputs.hubMintSealed) {
    return {
      ok: false,
      reason:
        "$HUB mint authority not yet revoked — refusing to auto-operate before the mint is sealed",
    };
  }
  return { ok: true };
}
