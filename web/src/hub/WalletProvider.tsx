import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearConnectedWallet, silentReconnect } from "./lib/wallets";

const STORAGE_KEY = "hub:wallet";

export type WalletContextValue = {
  /** Base58 address of the connected (or pasted/looked-up) wallet, shared app-wide. */
  address: string | null;
  /** True only while attempting a prompt-free reconnect right after page load. */
  connecting: boolean;
  /** Record a newly connected (or manually entered) address — call from any panel. */
  connect: (address: string) => void;
  /** Drop the address and the underlying signer registered in `lib/wallets`. */
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStored = (address: string | null) => {
  try {
    if (address) localStorage.setItem(STORAGE_KEY, address);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
};

/**
 * App-wide wallet identity: connect once (from the header, dashboard, or airdrop checker) and
 * every panel underneath — portfolio, activate, claim, swap, airdrop checker — reads the same
 * `address` via `useWallet()` instead of each keeping its own localStorage-synced copy. Actual
 * transaction signing still goes through `lib/wallets`' module-level signer registry
 * (`getSignerForAddress`, wired in via `HubProvider.resolveSigner`), unchanged.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => readStored());
  const [connecting, setConnecting] = useState(false);

  // Prompt-free restore after a reload — `onlyIfTrusted` resolves silently for authorized sites.
  useEffect(() => {
    const stored = readStored();
    if (!stored) return;
    let cancelled = false;
    setConnecting(true);
    silentReconnect(stored)
      .then((pk) => {
        if (cancelled) return;
        // A pasted/looked-up address (never actually connected via a wallet) can't be silently
        // re-signed-into; keep it visible read-only rather than clearing it.
        if (!pk) return;
        setAddress(pk);
      })
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const connect = useCallback((pk: string) => {
    setAddress(pk);
    writeStored(pk);
  }, []);

  const disconnect = useCallback(() => {
    clearConnectedWallet();
    setAddress(null);
    writeStored(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ address, connecting, connect, disconnect }),
    [address, connecting, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
