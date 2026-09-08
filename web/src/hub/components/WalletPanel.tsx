import { useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { shortKey } from "../lib/format";
import { useWallet } from "../WalletProvider";
import { ActivatePanel } from "./ActivatePanel";
import { ClaimPanel } from "./ClaimPanel";
import { HubPotPanel } from "./HubPotPanel";
import { SwapPanel } from "./SwapPanel";
import { Panel } from "./ui/Panel";
import { WalletConnect } from "./WalletConnect";
import { WalletPortfolio } from "./WalletPortfolio";

type Props = {
  state: ProtocolState;
  /** Host-supplied address (otchub passes its connected wallet); hides the connect UI. */
  walletAddress?: string;
};

/** WALLET_CONNECT → collapses to a `[ CONNECTED ✓ ]` bar + portfolio once an address is known.
 * Reads/writes the app-wide `WalletProvider` context, so connecting here (or from the header, or
 * from the airdrop checker) shows up everywhere else too. */
export function WalletPanel({ state, walletAddress }: Props) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;
  const [open, setOpen] = useState(false);
  // Same query key as WalletPortfolio → one fetch, shared by portfolio + claim rows.
  const portfolio = useWalletPortfolio(address, state);

  const connect = (pk: string) => {
    wallet.connect(pk);
    setOpen(false);
  };
  const clear = () => {
    wallet.disconnect();
  };

  if (!address) {
    return (
      <div className="space-y-2">
        <Panel title="WALLET_CONNECT :: HUB_PORTFOLIO">
          <p className="mb-2 text-[10px] text-green-500/50">
            tip: [CONNECT_WALLET] at the top of the page works from any tab — connect once, use it
            everywhere.
          </p>
          <WalletConnect onConnected={connect} />
        </Panel>
        <SwapPanel state={state} address={null} />
        <HubPotPanel />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!walletAddress && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between border border-green-500/30 bg-black px-3 py-2 text-left"
          title="reopen wallet connect"
        >
          <span className="text-[10px] uppercase tracking-widest text-green-500/70">
            WALLET_CONNECT
          </span>
          <span className="text-xs font-bold text-green-400">
            [ CONNECTED ✓ {shortKey(address, 6)} ]
          </span>
          <span className="text-[10px] text-green-500/40">{open ? "▴" : "▾"}</span>
        </button>
      )}
      {open && (
        <Panel title="SWITCH_WALLET">
          <WalletConnect onConnected={connect} />
        </Panel>
      )}
      <Panel title="PORTFOLIO">
        <WalletPortfolio
          address={address}
          state={state}
          onClear={walletAddress ? undefined : clear}
        />
      </Panel>
      <div className="grid gap-2 lg:grid-cols-2">
        <SwapPanel state={state} address={address} />
        <ClaimPanel
          address={address}
          state={state}
          desks={portfolio.data?.desks ?? []}
          onClaimed={() => void portfolio.refetch()}
        />
      </div>
      <ActivatePanel
        address={address}
        state={state}
        desks={portfolio.data?.desks ?? []}
        onChanged={() => void portfolio.refetch()}
      />
      <HubPotPanel desks={portfolio.data?.desks ?? []} address={address} />
    </div>
  );
}
