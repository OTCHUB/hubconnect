import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { EnvBadge, rpcHost, useHub, useWallet } from "./hub";
import { WalletConnect } from "./hub/components/WalletConnect";
import { AddressLink } from "./hub/components/ui/AddressLink";
import { CopyButton } from "./hub/components/ui/CopyButton";
import { DropletIcon, XIcon } from "./hub/components/ui/Icons";
import { shortKey } from "./hub/lib/format";
import { ThemeToggle } from "./components/ThemeToggle";

// otchub header buttons: bordered, uppercase, green-500/50 outline, sharp corners (rounded-none)
// — a system-terminal chrome bar, not a UI card.
const navLinkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive
    ? "border-green-400 bg-green-500/15 text-green-200"
    : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center whitespace-nowrap rounded-none border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

const dripLinkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive
    ? "border-amber-400 bg-amber-500/15 text-amber-200"
    : "border-amber-500/60 text-amber-400 hover:bg-amber-500/10";
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-none border px-2 py-1 text-[10px] font-bold tracking-widest sm:px-2.5 ${tone}`;
};

// otc/fomo/wallet cross-site action buttons — same square chrome as `navLinkCls`, one accent tone
// per link (1:1 with otchub's Home.jsx header buttons).
const pillLinkCls = (accent: "otc" | "fomo" | "wallet") => {
  const tone =
    accent === "fomo"
      ? "border-fuchsia-500/70 font-bold text-fuchsia-400 hover:bg-fuchsia-500/10"
      : accent === "wallet"
        ? "border-emerald-500/70 font-bold text-emerald-400 hover:bg-emerald-500/10"
        : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-none border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

// Icon-only square chrome for the X (Twitter) social link — same visual weight as the icon-only
// theme toggle, sitting between the text pills and the wallet control.
const iconLinkCls =
  "inline-flex h-7 w-7 items-center justify-center rounded-none border border-green-500/50 text-green-400 hover:bg-green-500/10";

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
        className={pillLinkCls("wallet")}
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
  const headerCls =
    "sticky top-[34px] z-40 rounded-none border border-green-500/30 bg-[#000000] font-mono";
  const dividerCls = "border-green-500/30";
  return (
    <header className={headerCls}>
      {/* Single-row identity bar: logo + label vertically centered, actions pinned right. Wraps
       *  onto its own line on narrow viewports instead of horizontally scrolling. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${dividerCls}`}
      >
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <img
            src="/hub-logo.png"
            alt="$HUB"
            className="h-6 w-6 shrink-0 cursor-help rounded-none border border-green-500/40"
            title="H.U.B. — Headquarters for Unhinged Brokers"
          />
          <h1 className="text-sm font-bold uppercase tracking-widest text-[#00FF00]">
            HUB Protocol
            <span className="hidden sm:inline"> :: YIELD OPTIMIZER</span>
            <span className="ml-1 inline-block animate-blink text-[#00FF00]">▋</span>
          </h1>
          <EnvBadge />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <a
            href="https://otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={pillLinkCls("otc")}
            title="OTC Hub — community analytics"
          >
            [OTC_HUB ↗]
          </a>
          <a
            href="https://fomo.otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={pillLinkCls("fomo")}
            title="RU_FOMO — live FOMO trader tape and signal bot"
          >
            [RU_FOMO ↗]
          </a>
          <a
            href="https://x.com/otchubdev"
            target="_blank"
            rel="noopener noreferrer"
            className={iconLinkCls}
            title="Follow @otchubdev on X"
            aria-label="Follow @otchubdev on X"
          >
            <XIcon className="h-3.5 w-3.5" />
          </a>
          <ThemeToggle />
          <HeaderWallet />
        </div>
      </div>
      <nav className={`flex flex-wrap items-center gap-1.5 border-b px-3 py-2 ${dividerCls}`}>
        <NavLink to="/hub" end className={navLinkCls}>
          DASHBOARD
        </NavLink>
        <NavLink to="/hub/treasury" className={navLinkCls}>
          TREASURY
        </NavLink>
        <NavLink to="/hub/tokenomics" className={navLinkCls}>
          TOKENOMICS
        </NavLink>
        <NavLink to="/hub/mechanics" className={navLinkCls}>
          MECHANICS
        </NavLink>
        <NavLink to="/hub/deployments" className={navLinkCls}>
          DEPLOYMENTS
        </NavLink>
        {cluster === "devnet" && (
          <NavLink
            to="/drip"
            className={dripLinkCls}
            title="devnet-only faucet — get test $HUB/$OTC + mint a Mock OTC Desk"
          >
            <DropletIcon className="h-3 w-3" />
            DRIP
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
