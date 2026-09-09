import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { EnvBadge, rpcHost, useHub, useUITheme, useWallet } from "./hub";
import { WalletConnect } from "./hub/components/WalletConnect";
import { AddressLink } from "./hub/components/ui/AddressLink";
import { CopyButton } from "./hub/components/ui/CopyButton";
import { DropletIcon, XIcon } from "./hub/components/ui/Icons";
import { ThemeSwitch } from "./hub/components/ui/ThemeSwitch";
import { shortKey } from "./hub/lib/format";
import { ThemeToggle } from "./components/ThemeToggle";

// otchub header buttons: bordered, uppercase, green-500/50 outline, sharp corners (rounded-none)
// in "retro" — a system-terminal chrome bar, not a UI card. "Modern" swaps every one of these for
// a soft translucent pill (rounded-full, backdrop-blur, sans-serif) so the header matches whatever
// theme the rest of the dashboard (see `Panel`) is currently rendering.
const navLinkCls =
  (isModern: boolean) =>
  ({ isActive }: { isActive: boolean }) => {
    if (isModern) {
      const tone = isActive
        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10";
      return `inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium sm:px-3 ${tone}`;
    }
    const tone = isActive
      ? "border-green-400 bg-green-500/15 text-green-200"
      : "border-green-500/50 text-green-400 hover:bg-green-500/10";
    return `inline-flex items-center whitespace-nowrap rounded-none border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
  };

const dripLinkCls =
  (isModern: boolean) =>
  ({ isActive }: { isActive: boolean }) => {
    if (isModern) {
      const tone = isActive
        ? "border-amber-400/60 bg-amber-400/20 text-amber-200"
        : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20";
      return `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:px-3 ${tone}`;
    }
    const tone = isActive
      ? "border-amber-400 bg-amber-500/15 text-amber-200"
      : "border-amber-500/60 text-amber-400 hover:bg-amber-500/10";
    return `inline-flex items-center gap-1 whitespace-nowrap rounded-none border px-2 py-1 text-[10px] font-bold tracking-widest sm:px-2.5 ${tone}`;
  };

// otc/fomo/wallet cross-site action buttons — same pill/square chrome as `navLinkCls`, one accent
// tone per link (1:1 with otchub's Home.jsx header buttons in "retro").
const pillLinkCls = (isModern: boolean, accent: "otc" | "fomo" | "wallet") => {
  if (isModern) {
    const tone =
      accent === "fomo"
        ? "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200 hover:bg-fuchsia-400/20"
        : accent === "wallet"
          ? "border-emerald-400/50 bg-emerald-400/15 font-semibold text-emerald-200 hover:bg-emerald-400/25"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10";
    return `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium sm:px-3 ${tone}`;
  }
  const tone =
    accent === "fomo"
      ? "border-fuchsia-500/70 font-bold text-fuchsia-400 hover:bg-fuchsia-500/10"
      : accent === "wallet"
        ? "border-emerald-500/70 font-bold text-emerald-400 hover:bg-emerald-500/10"
        : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-none border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

// Icon-only circular/square chrome for the X (Twitter) social link — same visual weight as the
// icon-only theme toggle, sitting between the text pills and the wallet control.
const iconLinkCls = (isModern: boolean) =>
  isModern
    ? "inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
    : "inline-flex h-7 w-7 items-center justify-center rounded-none border border-green-500/50 text-green-400 hover:bg-green-500/10";

/**
 * Top-of-app connect control — the one place a user needs to connect a wallet. Backed by the
 * app-wide `WalletProvider` (see `hub/WalletProvider.tsx`), so once connected here the same
 * address/signer is available to every panel below (portfolio, activate, claim, swap, airdrop
 * checker) without reconnecting.
 */
function HeaderWallet() {
  const { address, connecting, connect, disconnect } = useWallet();
  const { theme } = useUITheme();
  const isModern = theme === "modern";
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

  const label = isModern
    ? address
      ? shortKey(address, 4)
      : connecting
        ? "Reconnecting…"
        : "Connect Wallet"
    : address
      ? `[ ${shortKey(address, 4)} ]`
      : connecting
        ? "[ RECONNECTING... ]"
        : "[ CONNECT_WALLET ]";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={pillLinkCls(isModern, "wallet")}
        title={address ? "wallet menu" : "connect a wallet"}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div
          className={
            isModern
              ? "absolute right-0 top-full z-50 mt-2 w-[min(22rem,90vw)] rounded-2xl border border-white/10 bg-black/80 p-4 text-left font-sans shadow-xl shadow-black/40 backdrop-blur-xl"
              : "absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,90vw)] rounded-none border border-green-500/40 bg-black p-3 text-left shadow-lg shadow-black/60"
          }
        >
          {address ? (
            <div className="space-y-2">
              <div
                className={
                  isModern
                    ? "flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-emerald-300/60"
                    : "flex items-center justify-between text-[10px] uppercase tracking-widest text-green-500/60"
                }
              >
                <span>{isModern ? "Connected" : "CONNECTED"}</span>
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
                className={
                  isModern
                    ? "w-full rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-400/20"
                    : "w-full border border-amber-500/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
                }
              >
                {isModern ? "Disconnect" : "[DISCONNECT]"}
              </button>
              <div
                className={
                  isModern ? "border-t border-white/10 pt-3" : "border-t border-green-500/20 pt-2"
                }
              >
                <span
                  className={
                    isModern
                      ? "text-[10px] uppercase tracking-wide text-emerald-200/40"
                      : "text-[10px] text-green-500/50"
                  }
                >
                  {isModern ? "Switch wallet" : "SWITCH_WALLET:"}
                </span>
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
  const { theme } = useUITheme();
  const isModern = theme === "modern";
  const headerCls = isModern
    ? "sticky top-[34px] z-40 overflow-hidden rounded-2xl border border-emerald-500/20 bg-white/5 font-sans text-white backdrop-blur-xl"
    : "sticky top-[34px] z-40 rounded-none border border-green-500/30 bg-[#000000] font-mono";
  const dividerCls = isModern ? "border-white/10" : "border-green-500/30";
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
            className={`h-6 w-6 shrink-0 cursor-help border ${
              isModern ? "rounded-full border-emerald-400/30" : "rounded-none border-green-500/40"
            }`}
            title="H.U.B. — Headquarters for Unhinged Brokers"
          />
          <h1
            className={
              isModern
                ? "text-sm font-semibold tracking-tight text-white"
                : "text-sm font-bold uppercase tracking-widest text-[#00FF00]"
            }
          >
            HUB Protocol
            <span className="hidden sm:inline">
              {isModern ? " · Yield Optimizer" : " :: YIELD OPTIMIZER"}
            </span>
            {!isModern && <span className="ml-1 inline-block animate-blink text-[#00FF00]">▋</span>}
          </h1>
          <EnvBadge />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <a
            href="https://otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={pillLinkCls(isModern, "otc")}
            title="OTC Hub — community analytics"
          >
            {isModern ? "OTC Hub ↗" : "[OTC_HUB ↗]"}
          </a>
          <a
            href="https://fomo.otchub.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={pillLinkCls(isModern, "fomo")}
            title="RU_FOMO — live FOMO trader tape and signal bot"
          >
            {isModern ? "FOMO ↗" : "[RU_FOMO ↗]"}
          </a>
          <a
            href="https://x.com/otchubdev"
            target="_blank"
            rel="noopener noreferrer"
            className={iconLinkCls(isModern)}
            title="Follow @otchubdev on X"
            aria-label="Follow @otchubdev on X"
          >
            <XIcon className="h-3.5 w-3.5" />
          </a>
          <ThemeToggle />
          <ThemeSwitch />
          <HeaderWallet />
        </div>
      </div>
      <nav className={`flex flex-wrap items-center gap-1.5 border-b px-3 py-2 ${dividerCls}`}>
        <NavLink to="/hub" end className={navLinkCls(isModern)}>
          {isModern ? "Dashboard" : "DASHBOARD"}
        </NavLink>
        <NavLink to="/hub/treasury" className={navLinkCls(isModern)}>
          {isModern ? "Treasury" : "TREASURY"}
        </NavLink>
        <NavLink to="/hub/tokenomics" className={navLinkCls(isModern)}>
          {isModern ? "Tokenomics" : "TOKENOMICS"}
        </NavLink>
        <NavLink to="/hub/mechanics" className={navLinkCls(isModern)}>
          {isModern ? "Mechanics" : "MECHANICS"}
        </NavLink>
        <NavLink to="/hub/deployments" className={navLinkCls(isModern)}>
          {isModern ? "Deployments" : "DEPLOYMENTS"}
        </NavLink>
        {cluster === "devnet" && (
          <NavLink
            to="/drip"
            className={dripLinkCls(isModern)}
            title="devnet-only faucet — get test $HUB/$OTC + mint a Mock OTC Desk"
          >
            <DropletIcon className="h-3 w-3" />
            DRIP
          </NavLink>
        )}
      </nav>
      <div
        className={`flex flex-wrap items-center gap-x-4 px-3 py-1 text-[10px] ${
          isModern ? "text-emerald-200/40" : "text-green-500/50"
        }`}
      >
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}
