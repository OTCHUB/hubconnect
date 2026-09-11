import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HUB_BASE } from "../../config";
import { useHub } from "../HubProvider";
import { useWallet } from "../WalletProvider";
import { parsePubkey } from "../hooks/useDeskTier";
import { useProtocolState } from "../hooks/useProtocolState";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { ActivatePanel } from "../components/ActivatePanel";
import { WalletConnect } from "../components/WalletConnect";
import { Panel } from "../components/ui/Panel";
import { AddressLink } from "../components/ui/AddressLink";
import { ErrorBox, LoadingBox, UninitializedBox } from "../components/ui/StateBox";
import { Turnstile } from "../components/ui/Turnstile";
import { shortKey } from "../lib/format";
import {
  FaucetHttpError,
  dripTokens,
  fetchFaucetStatus,
  TURNSTILE_SITE_KEY,
  type DripResult,
} from "../lib/faucet";

const btn =
  "border px-3 py-1.5 text-xs font-bold disabled:opacity-30 border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10";

const SOLANA_FAUCET_URL = "https://faucet.solana.com";

/** otchub.dev/drip — the faucet page (backed by the devnet Worker deployed at otchub.dev/devnet
 * + otchub.dev/drip, see wrangler.jsonc's `devnet` env + workers/faucet.ts). Gated on the
 * connected cluster rather than the URL so a dev pointed at devnet from any host sees the same
 * faucet, and mainnet never can. */
export function DripPage() {
  const { cluster } = useHub();
  const wallet = useWallet();
  const [connectOpen, setConnectOpen] = useState(false);
  const [dripBusy, setDripBusy] = useState(false);
  const [dripErr, setDripErr] = useState<string | null>(null);
  const [dripResult, setDripResult] = useState<DripResult | null>(null);
  // Manual override: drip to any pasted devnet address without connecting a wallet at all. When
  // empty, falls back to the connected wallet (if any) — see `targetAddress` below.
  const [manualAddress, setManualAddress] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const activateRef = useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ["faucet", "status"],
    queryFn: fetchFaucetStatus,
    enabled: cluster === "devnet",
    staleTime: 30_000,
  });

  const trimmedManual = manualAddress.trim();
  const manualKey = trimmedManual ? parsePubkey(trimmedManual) : null;
  const manualInvalid = trimmedManual !== "" && !manualKey;
  const targetAddress = trimmedManual ? (manualKey?.toBase58() ?? null) : wallet.address;
  const requireTurnstile = !!TURNSTILE_SITE_KEY;
  // Activation needs a real signer — only offer the inline step when the drip actually landed on
  // the wallet connected right here (never for a manually-pasted foreign address; that case keeps
  // pointing at the dashboard below, same as before).
  const canActivateInline = !!wallet.address && !!targetAddress && targetAddress === wallet.address;
  const protocol = useProtocolState();
  const protocolState = protocol.status.kind === "ready" ? protocol.status.state : null;
  const portfolio = useWalletPortfolio(canActivateInline ? wallet.address : null, protocolState);

  useEffect(() => {
    setDripResult(null);
    setDripErr(null);
    setTurnstileToken(null);
  }, [wallet.address, manualAddress]);

  // Carry the eye straight down to the activation step once the starter kit (and its desk) lands.
  useEffect(() => {
    if (dripResult && canActivateInline) {
      activateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [dripResult, canActivateInline]);

  if (cluster !== "devnet") {
    return (
      <div className="space-y-2 font-mono">
        <Link to={HUB_BASE} className="text-[10px] text-green-600 hover:text-green-300">
          ← dashboard
        </Link>
        <Panel title="FAUCET :: DEVNET ONLY">
          <p className="text-xs text-green-400/90">
            This faucet only exists on devnet (otchub.dev/devnet) — it mints test $HUB/$OTC/M.I.M
            ETF basket tokens and Mock OTC Desk NFTs, and is never deployed for mainnet-beta. This
            app is currently connected to <span className="text-amber-300">{cluster}</span>.
          </p>
          <Link to={HUB_BASE} className="mt-2 inline-block text-xs text-cyan-300 underline">
            → go to the dashboard
          </Link>
        </Panel>
      </div>
    );
  }

  const runDrip = async () => {
    if (!targetAddress) return setDripErr("connect a wallet or paste a valid devnet address first");
    if (requireTurnstile && !turnstileToken) {
      return setDripErr("complete the verification challenge below first");
    }
    setDripBusy(true);
    setDripErr(null);
    try {
      const result = await dripTokens(targetAddress, turnstileToken ?? undefined);
      setDripResult(result);
      // Pick up the freshly-minted desk (and token balances) before ACTIVATE_DESK renders below.
      if (canActivateInline) await portfolio.refetch();
    } catch (e) {
      setDripErr(e instanceof FaucetHttpError ? e.message : "drip failed — try again");
    } finally {
      setDripBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-2 font-mono">
      <div className="flex items-center justify-between">
        <Link to={HUB_BASE} className="text-[10px] text-green-600 hover:text-green-300">
          ← dashboard
        </Link>
        <span className="text-[10px] uppercase tracking-widest text-green-600">
          devnet faucet — /drip
        </span>
      </div>

      <Panel title="1 · WALLET" collapsible>
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
        <div className="mt-3 border-t border-green-500/10 pt-2">
          <label className="mb-1 block text-[10px] uppercase tracking-widest text-green-600">
            or paste a devnet address to drip to — no wallet connection needed
          </label>
          <input
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="paste a base58 Solana address..."
            spellCheck={false}
            className={`w-full border bg-black px-2 py-1.5 text-xs text-green-400 outline-none placeholder:text-green-500/30 focus:border-green-400 ${
              manualInvalid ? "border-amber-500/60" : "border-green-500/30"
            }`}
          />
          {manualInvalid && (
            <div className="mt-1 text-[10px] text-amber-400">
              ERR: not a valid base58 Solana address
            </div>
          )}
        </div>
      </Panel>

      <Panel title="2 · GET DEVNET SOL FIRST">
        <p className="text-xs text-green-400/90">
          This faucet pays its own gas, never yours — claiming the starter kit below and later
          activating a desk both need <span className="text-amber-300">native devnet SOL</span> in
          your own wallet to cover transaction fees. Get some free from the official Solana faucet
          before you continue.
        </p>
        <a
          href={SOLANA_FAUCET_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-cyan-300 underline hover:text-cyan-100"
        >
          → {SOLANA_FAUCET_URL} ↗
        </a>
      </Panel>

      <Panel
        title="3 · GET STARTER KIT"
        right={
          status.data
            ? `faucet ${status.data.solLamports / 1e9} SOL`
            : status.isError
              ? "offline"
              : "…"
        }
      >
        <p className="mb-2 text-xs text-green-400/90">
          One request sends 100,000 $HUB, 100,000 $OTC, 10 each of CRCLx / NVDAx / SPCXx (the M.I.M
          ETF basket), and mints 1 unactivated Mock OTC Desk NFT — everything needed to activate a
          desk and test the HUB Pot claim. One request per wallet per 8h.
        </p>
        <div className="mb-2 rounded-none border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-300">
          The desk arrives not pre-activated on purpose: <code>activate_tier</code> requires the
          desk's current owner to sign, and <code>claim_yield</code> voids any tier whose owner
          changed since activation. Head to the{" "}
          <Link to={HUB_BASE} className="underline">
            dashboard
          </Link>{" "}
          after claiming and activate it yourself with the $HUB this faucet just gave you — the same
          flow a real desk owner follows on mainnet.
        </div>
        {targetAddress && (
          <div className="mb-2 text-[11px] text-green-600">
            dripping to: <AddressLink address={targetAddress} full />
          </div>
        )}
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          className="mb-2"
        />
        <button
          type="button"
          onClick={runDrip}
          disabled={dripBusy || !targetAddress || (requireTurnstile && !turnstileToken)}
          className={btn}
        >
          {dripBusy ? "[CLAIMING…]" : "[GET STARTER KIT]"}
        </button>
        {dripErr && <div className="mt-2 text-[11px] text-amber-400">ERR: {dripErr}</div>}
        {dripResult && (
          <div className="mt-2 space-y-1 text-[11px] text-green-400/90">
            <div>
              {dripResult.amounts.hub} $HUB · {dripResult.amounts.otc} $OTC ·{" "}
              {dripResult.amounts.crclx} CRCLx · {dripResult.amounts.nvdax} NVDAX ·{" "}
              {dripResult.amounts.spcxx} SPCXX
            </div>
            <a
              href={dripResult.explorer}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline hover:text-cyan-100"
            >
              {shortKey(dripResult.signature, 8)} ↗
            </a>
            <div>
              Desk #{dripResult.desk.deskNumber} — <AddressLink address={dripResult.desk.asset} />{" "}
              <a
                href={dripResult.desk.explorer}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline hover:text-cyan-100"
              >
                {shortKey(dripResult.desk.signature, 8)} ↗
              </a>
            </div>
            <div>
              {canActivateInline ? (
                <button
                  type="button"
                  onClick={() =>
                    activateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="text-emerald-300 underline hover:text-emerald-100"
                >
                  ↓ activate it below
                </button>
              ) : (
                <Link to={HUB_BASE} className="text-emerald-300 underline hover:text-emerald-100">
                  → activate it on the dashboard
                </Link>
              )}
            </div>
          </div>
        )}
      </Panel>

      {dripResult && canActivateInline && wallet.address && (
        <div ref={activateRef} className="space-y-2">
          <Panel title="4 · ACTIVATE YOUR DESK">
            <p className="text-xs text-green-400/90">
              Desk #{dripResult.desk.deskNumber} arrived unactivated on purpose — this step burns
              some of the $HUB the faucet just gave you to activate it into a paying tier, the exact
              same <code>activate_tier</code> call a real desk owner signs on mainnet. Pick a tier
              and pay method below, then press the green button.
            </p>
          </Panel>
          {protocol.status.kind === "ready" ? (
            <ActivatePanel
              address={wallet.address}
              state={protocol.status.state}
              desks={portfolio.data?.desks ?? []}
              selectedAsset={dripResult.desk.asset}
              onChanged={() => void portfolio.refetch()}
            />
          ) : protocol.status.kind === "error" ? (
            <ErrorBox message={protocol.status.message} />
          ) : protocol.status.kind === "uninitialized" ? (
            <UninitializedBox />
          ) : (
            <LoadingBox label="LOADING PROTOCOL STATE" />
          )}
        </div>
      )}

      <div className="text-[10px] text-green-700">
        devnet only · not affiliated with OTC Desks · faucet balances are public via{" "}
        <code>GET /api/faucet/status</code>
      </div>
    </div>
  );
}
