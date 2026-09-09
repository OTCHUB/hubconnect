import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useHub } from "../HubProvider";
import { useWallet } from "../WalletProvider";
import { WalletConnect } from "../components/WalletConnect";
import { Panel } from "../components/ui/Panel";
import { AddressLink } from "../components/ui/AddressLink";
import { shortKey } from "../lib/format";
import {
  FaucetHttpError,
  dripTokens,
  fetchFaucetStatus,
  mintMockDesk,
  type DripResult,
  type MintDeskResult,
} from "../lib/faucet";

const btn =
  "border px-3 py-1.5 text-xs font-bold disabled:opacity-30 border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10";

/** devnet.otchub.dev/drip — the only place the faucet Worker is deployed (see wrangler.jsonc's
 * `devnet` env + workers/faucet.ts). Gated on the connected cluster rather than the URL so a
 * dev pointed at devnet from any host sees the same faucet, and mainnet never can. */
export function DripPage() {
  const { cluster } = useHub();
  const wallet = useWallet();
  const [connectOpen, setConnectOpen] = useState(false);
  const [dripBusy, setDripBusy] = useState(false);
  const [deskBusy, setDeskBusy] = useState(false);
  const [dripErr, setDripErr] = useState<string | null>(null);
  const [deskErr, setDeskErr] = useState<string | null>(null);
  const [dripResult, setDripResult] = useState<DripResult | null>(null);
  const [deskResult, setDeskResult] = useState<MintDeskResult | null>(null);

  const status = useQuery({
    queryKey: ["faucet", "status"],
    queryFn: fetchFaucetStatus,
    enabled: cluster === "devnet",
    staleTime: 30_000,
  });

  useEffect(() => {
    setDripResult(null);
    setDeskResult(null);
    setDripErr(null);
    setDeskErr(null);
  }, [wallet.address]);

  if (cluster !== "devnet") {
    return (
      <div className="space-y-2 font-mono">
        <Link to="/hub" className="text-[10px] text-green-600 hover:text-green-300">
          ← dashboard
        </Link>
        <Panel title="FAUCET :: DEVNET ONLY">
          <p className="text-xs text-green-400/90">
            This faucet only exists on devnet (devnet.otchub.dev) — it mints test $HUB/$OTC/M.I.M
            ETF basket tokens and Mock OTC Desk NFTs, and is never deployed for mainnet-beta. This
            app is currently connected to <span className="text-amber-300">{cluster}</span>.
          </p>
          <Link to="/hub" className="mt-2 inline-block text-xs text-cyan-300 underline">
            → go to the dashboard
          </Link>
        </Panel>
      </div>
    );
  }

  const runDrip = async () => {
    if (!wallet.address) return setDripErr("connect a wallet first");
    setDripBusy(true);
    setDripErr(null);
    try {
      setDripResult(await dripTokens(wallet.address));
    } catch (e) {
      setDripErr(e instanceof FaucetHttpError ? e.message : "drip failed — try again");
    } finally {
      setDripBusy(false);
    }
  };

  const runMintDesk = async () => {
    if (!wallet.address) return setDeskErr("connect a wallet first");
    setDeskBusy(true);
    setDeskErr(null);
    try {
      setDeskResult(await mintMockDesk(wallet.address));
    } catch (e) {
      setDeskErr(e instanceof FaucetHttpError ? e.message : "mint failed — try again");
    } finally {
      setDeskBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-2 font-mono">
      <div className="flex items-center justify-between">
        <Link to="/hub" className="text-[10px] text-green-600 hover:text-green-300">
          ← dashboard
        </Link>
        <span className="text-[10px] uppercase tracking-widest text-green-600">
          devnet faucet — /drip
        </span>
      </div>

      <Panel title="1 · WALLET">
        {wallet.address ? (
          <div className="flex items-center justify-between text-xs">
            <span>
              connected: <AddressLink address={wallet.address} full />
            </span>
            <button
              type="button"
              onClick={() => wallet.disconnect()}
              className="text-[10px] text-amber-400 underline hover:text-amber-200"
            >
              disconnect
            </button>
          </div>
        ) : connectOpen ? (
          <WalletConnect
            onConnected={(pk) => {
              wallet.connect(pk);
              setConnectOpen(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setConnectOpen(true)} className={btn}>
            [CONNECT WALLET]
          </button>
        )}
      </Panel>

      <Panel
        title="2 · GET $HUB + $OTC + M.I.M ETF BASKET"
        right={status.data ? `faucet ${status.data.solLamports / 1e9} SOL` : status.isError ? "offline" : "…"}
      >
        <p className="mb-2 text-xs text-green-400/90">
          One drip sends 5,000 $HUB, 2,000 $OTC, and 500 each of CRCLx / OpenAI / Anthropic (the
          M.I.M ETF basket) to your wallet — enough to activate a desk and test the HUB Pot claim.
          One drip per wallet per 24h.
        </p>
        <button type="button" onClick={runDrip} disabled={dripBusy || !wallet.address} className={btn}>
          {dripBusy ? "[DRIPPING…]" : "[GET $HUB + $OTC + BASKET]"}
        </button>
        {dripErr && <div className="mt-2 text-[11px] text-amber-400">ERR: {dripErr}</div>}
        {dripResult && (
          <div className="mt-2 space-y-1 text-[11px] text-green-400/90">
            <div>
              {dripResult.amounts.hub} $HUB · {dripResult.amounts.otc} $OTC · {dripResult.amounts.crclx}{" "}
              CRCLx · {dripResult.amounts.openai} OPENAI · {dripResult.amounts.anthropic} ANTHROPIC
            </div>
            <a
              href={dripResult.explorer}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline hover:text-cyan-100"
            >
              {shortKey(dripResult.signature, 8)} ↗
            </a>
          </div>
        )}
      </Panel>

      <Panel title="3 · MINT A MOCK OTC DESK NFT">
        <p className="mb-2 text-xs text-green-400/90">
          Mints an unactivated Mock OTC Desk (Metaplex Core, real Config.desk_collection PDA
          derivation) directly to your wallet — you'll be the owner, exactly like a real mainnet
          desk. One mint per wallet per 6h.
        </p>
        <div className="mb-2 rounded-none border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-300">
          Not pre-activated on purpose: <code>activate_tier</code> requires the desk's current
          owner to sign, and <code>claim_yield</code> voids any tier whose owner changed since
          activation. Head to the <Link to="/hub" className="underline">dashboard</Link> after
          minting and activate it yourself with the $HUB this faucet just gave you — the same flow
          a real desk owner follows on mainnet.
        </div>
        <button
          type="button"
          onClick={runMintDesk}
          disabled={deskBusy || !wallet.address}
          className={btn}
        >
          {deskBusy ? "[MINTING…]" : "[MINT MOCK OTC DESK]"}
        </button>
        {deskErr && <div className="mt-2 text-[11px] text-amber-400">ERR: {deskErr}</div>}
        {deskResult && (
          <div className="mt-2 space-y-1 text-[11px] text-green-400/90">
            <div>
              Desk #{deskResult.deskNumber} — <AddressLink address={deskResult.asset} />
            </div>
            <a
              href={deskResult.explorer}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline hover:text-cyan-100"
            >
              {shortKey(deskResult.signature, 8)} ↗
            </a>
            <div>
              <Link to="/hub" className="text-emerald-300 underline hover:text-emerald-100">
                → activate it on the dashboard
              </Link>
            </div>
          </div>
        )}
      </Panel>

      <div className="text-[10px] text-green-700">
        devnet only · not affiliated with OTC Desks · faucet balances are public via{" "}
        <code>GET /api/faucet/status</code>
      </div>
    </div>
  );
}
