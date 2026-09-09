import { useRef, useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { shortKey } from "../lib/format";
import { useWallet } from "../WalletProvider";
import { ActivatePanel } from "./ActivatePanel";
import { ClaimPanel } from "./ClaimPanel";
import { HubPotPanel } from "./HubPotPanel";
import { GlassPanel } from "./ui/GlassPanel";
import { Panel } from "./ui/Panel";
import { WalletConnect } from "./WalletConnect";
import { WalletPortfolio } from "./WalletPortfolio";

type Props = {
  state: ProtocolState;
  /** Host-supplied address (otchub passes its connected wallet); hides the connect UI. */
  walletAddress?: string;
};

/** Wallet Connect :: HUB Portfolio — the app's one centralized wallet controller. Sits at the top
 * of the dashboard (see routes/Dashboard.tsx) so it's the first thing every other panel below
 * (portfolio, claim, activate, HUB pot) implicitly depends on. Reads/writes the app-wide
 * `WalletProvider` context via `useWallet`, so connecting here (or from the header, or from the
 * airdrop checker) shows up everywhere else too. The connect flow itself renders on a frosted-glass
 * `GlassPanel` (minimalist, "new age of internet finance" surface) rather than the DOS look used
 * elsewhere — collapsed, it shrinks to a single `● Connected · 0x123…abcd` / `○ Disconnected`
 * summary line so it doesn't dominate the page once a wallet is already hooked up. */
export function WalletPanel({ state, walletAddress }: Props) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;
  const [switchOpen, setSwitchOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const activateRef = useRef<HTMLDivElement>(null);
  // Same query key as WalletPortfolio → one fetch, shared by portfolio + claim rows.
  const portfolio = useWalletPortfolio(address, state);

  // From a PORTFOLIO desk card's [HUB_ACTIVATE →]/[UPGRADE_TIER →]: preselect it below and scroll
  // to it.
  const jumpToActivate = (asset: string) => {
    setSelectedAsset(asset);
    activateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const connect = (pk: string) => {
    wallet.connect(pk);
    setSwitchOpen(false);
  };
  const clear = () => {
    wallet.disconnect();
  };

  const statusLine = (
    <div className="flex flex-wrap items-center gap-2">
      <span className={address ? "font-bold text-emerald-300" : "font-bold text-amber-400"}>
        {address ? "● Connected" : "○ Disconnected"}
      </span>
      {address && <span className="text-green-500/70">{shortKey(address, 6)}</span>}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-transparent p-4 font-sans backdrop-blur-xl sm:p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden>
            ⚡
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/70">
              What is HUB Protocol?
            </div>
            <p className="mt-1 text-sm leading-relaxed text-white/85">
              <span className="font-semibold text-white">HUB Protocol</span> — the sovereign
              liquidity layer for the new age of internet finance. Decentralized OTC desks,
              automated treasury yields, and the home of{" "}
              <span className="font-semibold text-emerald-300">Magic Internet Money</span>.
            </p>
          </div>
        </div>
      </div>

      <GlassPanel
        title="Wallet Connect"
        icon="🔐"
        collapsible
        defaultCollapsed={!!address}
        collapsedSummary={statusLine}
      >
        {!address ? (
          <>
            <p className="mb-2 text-xs text-emerald-200/40">
              Tip: connecting once here works everywhere across the dashboard.
            </p>
            <WalletConnect onConnected={connect} />
          </>
        ) : (
          <div className="space-y-2">
            {statusLine}
            {!walletAddress && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSwitchOpen((o) => !o)}
                  className="text-xs text-emerald-200/70 underline hover:text-emerald-100"
                >
                  {switchOpen ? "Cancel switch" : "Switch wallet"}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-amber-300 underline hover:text-amber-200"
                >
                  Disconnect
                </button>
              </div>
            )}
            {switchOpen && <WalletConnect onConnected={connect} />}
          </div>
        )}
      </GlassPanel>

      {!address && <HubPotPanel />}
      {address && (
        <>
          <Panel title="PORTFOLIO" collapsible>
            <WalletPortfolio
              address={address}
              state={state}
              onClear={walletAddress ? undefined : clear}
              onActivate={jumpToActivate}
            />
          </Panel>
          <ClaimPanel
            address={address}
            state={state}
            desks={portfolio.data?.desks ?? []}
            onClaimed={() => void portfolio.refetch()}
          />
          <div ref={activateRef}>
            <ActivatePanel
              address={address}
              state={state}
              desks={portfolio.data?.desks ?? []}
              selectedAsset={selectedAsset}
              onChanged={() => void portfolio.refetch()}
            />
          </div>
          <HubPotPanel desks={portfolio.data?.desks ?? []} address={address} />
        </>
      )}
    </div>
  );
}
