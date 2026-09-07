import { useEffect, useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { shortKey } from "../lib/format";
import { silentReconnect } from "../lib/wallets";
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
  };
  const clear = () => {
    setAddress(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
  };

  if (!address) {
    return (
      <Panel title="WALLET_CONNECT :: HUB_PORTFOLIO">
        <WalletConnect onConnected={connect} />
      </Panel>
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
    </div>
  );
}
