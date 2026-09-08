import { useMemo, useState, type FormEvent } from "react";
import type { ProtocolState } from "@hub-sdk";
import { parsePubkey } from "../hooks/useDeskTier";
import { useDeskByNumber } from "../hooks/useDeskByNumber";
import { shortKey } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { WalletPortfolio } from "./WalletPortfolio";

type Props = { state: ProtocolState };

type Query = { kind: "wallet"; address: string } | { kind: "id"; deskNumber: number };

const inputCls =
  "flex-1 border border-green-500/30 bg-black px-2 py-1 text-xs text-green-300 outline-none focus:border-green-400";

/** Numeric input ⇒ OTC Desk ID; otherwise it must parse as a base58 wallet/asset pubkey. */
function classify(raw: string): { query: Query | null; error: string | null } {
  const value = raw.trim();
  if (!value) return { query: null, error: null };
  if (/^\d+$/.test(value)) {
    const deskNumber = Number(value);
    return deskNumber > 0
      ? { query: { kind: "id", deskNumber }, error: null }
      : { query: null, error: "desk id must be a positive integer" };
  }
  const key = parsePubkey(value);
  return key
    ? { query: { kind: "wallet", address: key.toBase58() }, error: null }
    : { query: null, error: "not a numeric desk id or a valid wallet address" };
}

/** §A4 / instructions::pot::round_credit — every activation/upgrade step books 90% of the 0.5
 *  SOL fee into the pot (10% to ops); a desk's tier weight (10,000–20,000 bp) then determines its
 *  share of that pot each round. This is the "extra boosted yield" a higher tier earns over T1. */
const BOOST_NOTE =
  "extra boosted yield = tier weight vs the T1 baseline. Each 0.5 SOL activation/upgrade step " +
  "pays 90% into the pot (10% to ops, §A4); higher tiers carry more weight, so they earn a " +
  "proportionally larger share of every round's payout.";

function DeskIdResult({ deskNumber, state }: { deskNumber: number; state: ProtocolState }) {
  const q = useDeskByNumber(deskNumber, state.config);

  if (q.isPending) {
    return (
      <div className="text-xs text-green-500/50">
        <span className="animate-pulse">▋</span> RESOLVING OTC DESK #{deskNumber}...
      </div>
    );
  }
  if (q.isError) {
    return <div className="text-xs text-amber-400">ERR: {(q.error as Error).message}</div>;
  }
  if (!q.data || !q.data.owner) {
    return (
      <div className="text-xs text-amber-400">
        OTC Desk #{deskNumber} not found. DAS-based id lookup needs a Helius/Triton-style RPC and
        only covers desks currently minted into {shortKey(state.config.deskCollection)} — try the
        exact wallet address or asset pubkey instead.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] tracking-widest text-green-500/70">
        OTC DESK #{deskNumber} :: <AddressLink address={q.data.asset} /> owned by{" "}
        <AddressLink address={q.data.owner} />
      </div>
      <WalletPortfolio address={q.data.owner} state={state} />
    </div>
  );
}

/**
 * Search by OTC Desk ID (numeric, resolved via DAS) or by a wallet address (Pubkey) — both modes
 * hand off to the shared `WalletPortfolio` view for the resolved owner, so $HUB balance and the
 * per-desk yield boost render identically regardless of which way the desk was found.
 */
export function DeskLookupPanel({ state }: Props) {
  const [raw, setRaw] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { query, error } = useMemo(() => classify(submitted), [submitted]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(raw);
  };
  const clear = () => {
    setRaw("");
    setSubmitted("");
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-col gap-1">
        <div className="flex gap-2">
          <span className="text-xs text-green-600">C:\HUB&gt;</span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="desk id (e.g. 42) or wallet address"
            spellCheck={false}
            className={inputCls}
          />
          <button
            type="submit"
            className="border border-green-500/40 px-3 text-xs text-green-300 hover:bg-green-500/10"
          >
            LOOKUP
          </button>
          {submitted && (
            <button
              type="button"
              onClick={clear}
              className="border border-green-500/20 px-3 text-xs text-green-600 hover:text-green-300"
            >
              CLEAR
            </button>
          )}
        </div>
        {error && <div className="text-[10px] text-red-400">{error}</div>}
      </form>

      {query?.kind === "wallet" && <WalletPortfolio address={query.address} state={state} />}
      {query?.kind === "id" && <DeskIdResult deskNumber={query.deskNumber} state={state} />}
      {query && <div className="text-[10px] text-green-700">{BOOST_NOTE}</div>}
    </div>
  );
}
