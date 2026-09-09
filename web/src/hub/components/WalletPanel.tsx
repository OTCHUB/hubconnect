import { useRef, useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { shortKey } from "../lib/format";
import { useWallet } from "../WalletProvider";
import { ActivatePanel } from "./ActivatePanel";
import { ClaimPanel } from "./ClaimPanel";
import { HubPotPanel } from "./HubPotPanel";
import { Panel } from "./ui/Panel";
import { WalletConnect } from "./WalletConnect";
import { WalletPortfolio } from "./WalletPortfolio";

type Props = {
  state: ProtocolState;
  /** Host-supplied address (otchub passes its connected wallet); hides the connect UI. */
  walletAddress?: string;
};

/** WALLET_CONNECT :: HUB_PORTFOLIO — the app's one centralized wallet controller. Sits at the top
 * of the dashboard (see routes/Dashboard.tsx) so it's the first thing every other panel below
 * (portfolio, claim, activate, HUB pot) implicitly depends on. Reads/writes the app-wide
 * `WalletProvider` context via `useWallet`, so connecting here (or from the header, or from the
 * airdrop checker) shows up everywhere else too. Collapsible: collapsed, it shrinks to a single
 * `Connected · 0x123…abcd` / `Disconnected` summary line so it doesn't dominate the page once a
 * wallet is already hooked up. */
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
      <Panel
        title="WALLET_CONNECT :: HUB_PORTFOLIO"
        collapsible
        defaultCollapsed={!!address}
        collapsedSummary={statusLine}
      >
        {!address ? (
          <>
            <p className="mb-2 text-[10px] text-green-500/50">
              tip: [CONNECT_WALLET] at the top of the page works from any tab — connect once, use it
              everywhere.
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
                  className="text-[10px] text-green-500 underline hover:text-green-300"
                >
                  {switchOpen ? "[cancel switch]" : "[switch wallet]"}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="text-[10px] text-amber-400 underline hover:text-amber-200"
                >
                  [disconnect]
                </button>
              </div>
            )}
            {switchOpen && <WalletConnect onConnected={connect} />}
          </div>
        )}
      </Panel>

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
