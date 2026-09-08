import { useState, type FormEvent } from "react";
import { AIRDROP_DESK_CAP, AIRDROP_PER_DESK, type ProtocolState } from "@hub-sdk";
import { parsePubkey } from "../hooks/useDeskTier";
import { useTokenomics } from "../hooks/useTokenomics";
import { useAirdropCheck } from "../hooks/useAirdropCheck";
import { useWallet } from "../WalletProvider";
import { fmtHub, fmtUtc, shortKey } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { Flag, Panel, Row } from "./ui/Panel";
import { WalletConnect } from "./WalletConnect";

const inputCls =
  "min-w-0 flex-1 border border-green-500/30 bg-black px-2 py-1.5 text-xs text-green-400 outline-none placeholder:text-green-500/30 focus:border-green-400";
const btnCls =
  "border border-green-500/50 px-3 py-1.5 text-xs text-green-400 hover:bg-green-500/10 disabled:opacity-40";

/**
 * §A7.1 genesis airdrop checker — paste an address or connect a wallet to see every OTC Desk NFT
 * it holds and whether that desk's snapshot allocation has been paid out yet. Read-only: no
 * signing, no claim button (payout is authority-pushed — see `distribute_airdrop`).
 */
export function AirdropChecker({ state }: { state: ProtocolState }) {
  const wallet = useWallet();
  // A locally-looked-up address (paste or a different connect) overrides the app-wide wallet for
  // this checker only, without switching what the rest of the app treats as "your" wallet.
  const [lookupAddress, setLookupAddress] = useState<string | null>(null);
  const address = lookupAddress ?? wallet.address;
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const tok = useTokenomics(state);
  const check = useAirdropCheck(address, state);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const key = parsePubkey(manual);
    if (!key) return setErr("not a valid base58 wallet address");
    setErr(null);
    setLookupAddress(key.toBase58());
  };

  const onChain = tok.data?.onChain ?? null;
  const live = !!onChain?.airdropRootSet;

  return (
    <div className="space-y-3">
      <Panel title="AIRDROP CHECKER" right={<Flag on={live} label="SNAPSHOT" />}>
        {tok.isPending && <div className="text-xs text-green-600">loading airdrop status…</div>}
        {tok.error && <div className="text-xs text-red-400">{(tok.error as Error).message}</div>}
        {tok.data && (
          <div className="space-y-1 text-xs">
            <Row k="per-desk allocation" v={`${AIRDROP_PER_DESK.toLocaleString()} $HUB`} />
            <Row k="desk cap" v={AIRDROP_DESK_CAP.toLocaleString()} />
            <Row k="snapshot published" v={live ? "YES" : "NOT YET — genesis pending"} />
            {onChain && live && (
              <>
                <Row k="snapshot desks" v={onChain.snapshotDeskCount.toLocaleString()} />
                <Row k="snapshot round" v={onChain.snapshotRound} />
                <Row
                  k="claims paid"
                  v={`${onChain.airdropClaims.toLocaleString()} / ${onChain.snapshotDeskCount.toLocaleString()}`}
                />
                <Row k="units distributed" v={fmtHub(onChain.airdropClaimedUnits)} />
              </>
            )}
          </div>
        )}
        {tok.data && !live && (
          <div className="mt-2 border border-amber-500/30 p-2 text-[10px] leading-relaxed text-amber-400">
            AIRDROP CHECKER NOT YET LIVE — the genesis snapshot has not been published on-chain.
            This page starts reporting real eligibility/claim status once the team runs the mainnet
            snapshot script and publishes the root via `set_airdrop_root`.
          </div>
        )}
      </Panel>

      <Panel title="CHECK AN ADDRESS">
        {wallet.address && !lookupAddress ? (
          <div className="mb-2 text-[10px] text-green-500/50">
            showing your connected wallet ({shortKey(wallet.address, 4)}) — paste a different
            address below to check someone else's.
          </div>
        ) : (
          <WalletConnect
            onConnected={(pk) => {
              wallet.connect(pk);
              setLookupAddress(null);
            }}
          />
        )}
        <form onSubmit={submitManual} className="mt-2 flex flex-wrap gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="OR PASTE WALLET ADDRESS..."
            spellCheck={false}
            className={inputCls}
          />
          <button type="submit" className={btnCls}>
            [CHECK]
          </button>
        </form>
        {err && <div className="mt-1 text-xs text-amber-400">ERR: {err}</div>}
      </Panel>

      {address && (
        <Panel
          title={`RESULT — ${shortKey(address)}`}
          right={
            <span className="flex items-center gap-2">
              <AddressLink address={address} />
              {lookupAddress && wallet.address && wallet.address !== lookupAddress && (
                <button
                  type="button"
                  onClick={() => setLookupAddress(null)}
                  className="text-green-600 hover:text-green-300"
                >
                  [BACK TO MY WALLET]
                </button>
              )}
            </span>
          }
        >
          {check.isPending && <div className="text-xs text-green-600">scanning owned desks…</div>}
          {check.error && (
            <div className="text-xs text-red-400">{(check.error as Error).message}</div>
          )}
          {check.data && check.data.length === 0 && (
            <div className="text-xs text-green-600">no OTC Desk NFTs held by this address.</div>
          )}
          {check.data && check.data.length > 0 && (
            <div className="space-y-1">
              {check.data.map((r) => (
                <div
                  key={r.asset}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/10 py-1 text-xs last:border-0"
                >
                  <AddressLink address={r.asset} label={r.art?.name ?? shortKey(r.asset)} />
                  {r.claim ? (
                    <span className="text-green-300">
                      PAID {fmtHub(r.claim.amountUnits)} · {fmtUtc(r.claim.claimedTs)}
                    </span>
                  ) : (
                    <span className="text-green-700">
                      {live ? "not yet distributed" : "snapshot not published"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
