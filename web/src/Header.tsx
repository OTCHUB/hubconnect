import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { EnvBadge, rpcHost, useHub, useWallet } from "./hub";
import { WalletConnect } from "./hub/components/WalletConnect";
import { AddressLink } from "./hub/components/ui/AddressLink";
import { CopyButton } from "./hub/components/ui/CopyButton";
import { ThemeSwitch } from "./hub/components/ui/ThemeSwitch";
import { shortKey } from "./hub/lib/format";
import { ThemeToggle } from "./components/ThemeToggle";

// otchub header buttons: bordered, uppercase, green-500/50 outline, tinted when active. Sharp
// corners (rounded-none) throughout — the header is a system-terminal chrome bar, not a UI card.
const linkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive
    ? "border-green-400 bg-green-500/15 text-green-200"
    : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center whitespace-nowrap rounded-none border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

// otc-link: 1:1 with otchub's cross-site action buttons (Home.jsx header).
const otcLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-none border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10 sm:px-2.5";
const fomoLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-none border border-fuchsia-500/70 px-2 py-1 text-[10px] font-bold tracking-widest text-fuchsia-400 hover:bg-fuchsia-500/10 sm:px-2.5";
const walletLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-none border border-emerald-500/70 px-2 py-1 text-[10px] font-bold tracking-widest text-emerald-400 hover:bg-emerald-500/10 sm:px-2.5";

/**
 * Top-of-app connect control — the one place a user needs to connect a wallet. Backed by the
 * app-wide `WalletProvider` (see `hub/WalletProvider.tsx`), so once connected here the same
 * address/signer is available to every panel below (portfolio, activate, claim, swap, airdrop
 * checker) without reconnecting.
 */
function HeaderWallet() {
  const { address, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const onConnected = (pk: string) => {
    connect(pk);
    setOpen(false);
  };

  const label = address
    ? `[ ${shortKey(address, 4)} ]`
    : connecting
      ? "[ RECONNECTING... ]"
      : "[ CONNECT_WALLET ]";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={walletLinkCls}
        title={address ? "wallet menu" : "connect a wallet"}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,90vw)] rounded-none border border-green-500/40 bg-black p-3 text-left shadow-lg shadow-black/60">
          {address ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-green-500/60">
                <span>CONNECTED</span>
                <CopyButton text={address} />
              </div>
              <div className="text-xs">
                <AddressLink address={address} full />
              </div>
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="w-full border border-amber-500/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
              >
                [DISCONNECT]
              </button>
              <div className="border-t border-green-500/20 pt-2">
                <span className="text-[10px] text-green-500/50">SWITCH_WALLET:</span>
                <div className="mt-1.5">
                  <WalletConnect onConnected={onConnected} />
                </div>
              </div>
            </div>
          ) : (
            <WalletConnect onConnected={onConnected} />
          )}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="sticky top-[34px] z-40 rounded-none border border-green-500/30 bg-[#000000] font-mono">
      {/* Single-row identity bar: logo + label vertically centered, actions pinned right. */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto whitespace-nowrap border-b border-green-500/30 px-3 py-2">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <img
            src="/hub-logo.png"
            alt="$HUB"
            className="h-6 w-6 shrink-0 cursor-help rounded-none border border-green-500/40"
            title="H.U.B. — Headquarters for Unhinged Brokers"
          />
          <h1 className="text-sm font-bold uppercase tracking-widest text-[#00FF00]">
            HUB Protocol :: YIELD OPTIMIZER
            <span className="ml-1 inline-block animate-blink text-[#00FF00]">▋</span>
          </h1>
          <EnvBadge />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <a
            href="https://otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={otcLinkCls}
            title="OTC Hub — community analytics"
          >
            [OTC_HUB ↗]
          </a>
          <a
            href="https://fomo.otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={fomoLinkCls}
            title="RU_FOMO — live FOMO trader tape and signal bot"
          >
            [RU_FOMO ↗]
          </a>
          <ThemeToggle />
          <ThemeSwitch />
          <HeaderWallet />
        </div>
      </div>
      <nav className="flex flex-wrap items-center gap-1.5 border-b border-green-500/30 px-3 py-2">
        <NavLink to="/hub" end className={linkCls}>
          DASHBOARD
        </NavLink>
        <NavLink to="/hub/treasury" className={linkCls}>
          TREASURY
        </NavLink>
        <NavLink to="/hub/tokenomics" className={linkCls}>
          TOKENOMICS
        </NavLink>
        <NavLink to="/hub/mechanics" className={linkCls}>
          MECHANICS
        </NavLink>
        <NavLink to="/hub/deployments" className={linkCls}>
          DEPLOYMENTS
        </NavLink>
        {cluster === "devnet" && (
          <NavLink
            to="/drip"
            className={({ isActive }) =>
              `inline-flex items-center whitespace-nowrap rounded-none border px-2 py-1 text-[10px] font-bold tracking-widest sm:px-2.5 ${
                isActive
                  ? "border-amber-400 bg-amber-500/15 text-amber-200"
                  : "border-amber-500/60 text-amber-400 hover:bg-amber-500/10"
              }`
            }
            title="devnet-only faucet — get test $HUB/$OTC + mint a Mock OTC Desk"
          >
            💧 DRIP
          </NavLink>
        )}
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 px-3 py-1 text-[10px] text-green-500/50">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}
