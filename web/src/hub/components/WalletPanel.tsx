import { useEffect, useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { shortKey } from "../lib/format";
import { silentReconnect } from "../lib/wallets";
import { ActivatePanel } from "./ActivatePanel";
import { ClaimPanel } from "./ClaimPanel";
import { SwapPanel } from "./SwapPanel";
import { Panel } from "./ui/Panel";
import { WalletConnect } from "./WalletConnect";
import { WalletPortfolio } from "./WalletPortfolio";

const STORAGE_KEY = "hub:wallet";

type Props = {
  state: ProtocolState;
  /** Host-supplied address (otchub passes its connected wallet); hides the connect UI. */
  walletAddress?: string;
};

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** WALLET_CONNECT → collapses to a `[ CONNECTED ✓ ]` bar + portfolio once an address is known. */
export function WalletPanel({ state, walletAddress }: Props) {
  const [address, setAddress] = useState<string | null>(() => walletAddress ?? readStored());
  const [open, setOpen] = useState(false);
  // Same query key as WalletPortfolio → one fetch, shared by portfolio + claim rows.
  const portfolio = useWalletPortfolio(address, state);

  useEffect(() => {
    if (walletAddress) setAddress(walletAddress);
  }, [walletAddress]);

  // Prompt-free restore after reload; the stored address stays visible read-only either way.
  useEffect(() => {
    const stored = readStored();
    if (!walletAddress && stored) void silentReconnect(stored);
  }, [walletAddress]);

  const connect = (pk: string) => {
    setAddress(pk);
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, pk);
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event("hub:wallet-changed"));
  };
  const clear = () => {
    setAddress(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event("hub:wallet-changed"));
  };

  if (!address) {
    return (
      <div className="space-y-2">
        <Panel title="WALLET_CONNECT :: HUB_PORTFOLIO">
          <WalletConnect onConnected={connect} />
        </Panel>
        <SwapPanel state={state} address={null} />
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
    </div>
  );
}
