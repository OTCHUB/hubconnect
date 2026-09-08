import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { EnvBadge, rpcHost, useHub } from "./hub";
import { shortKey } from "./hub/lib/format";

// otchub header buttons: bordered, uppercase, green-500/50 outline, tinted when active.
const linkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive
    ? "border-green-400 bg-green-500/15 text-green-200"
    : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center whitespace-nowrap border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

// otc-link: 1:1 with otchub's cross-site action buttons (Home.jsx header).
const otcLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10 sm:px-2.5";
const fomoLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap border border-fuchsia-500/70 px-2 py-1 text-[10px] font-bold tracking-widest text-fuchsia-400 hover:bg-fuchsia-500/10 sm:px-2.5";
const walletLinkCls =
  "inline-flex items-center gap-1 whitespace-nowrap border border-emerald-500/70 px-2 py-1 text-[10px] font-bold tracking-widest text-emerald-400 hover:bg-emerald-500/10 sm:px-2.5";

const WALLET_STORAGE_KEY = "hub:wallet";

/** Compact connect/status control — mirrors WalletPanel's connected state (same storage key +
 * change event) without duplicating the full connect flow; jumps to/opens the WALLET_CONNECT
 * panel on the dashboard route. */
function HeaderWallet() {
  const [address, setAddress] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WALLET_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const refresh = () => {
      try {
        setAddress(localStorage.getItem(WALLET_STORAGE_KEY));
      } catch {
        setAddress(null);
      }
    };
    window.addEventListener("hub:wallet-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hub:wallet-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const goToWallet = () => {
    document.getElementById("hub-wallet")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <a href="#hub-wallet" onClick={goToWallet} className={walletLinkCls} title="wallet connect">
      {address ? `[ ${shortKey(address, 4)} ]` : "[ CONNECT_WALLET ]"}
    </a>
  );
}

export function Header() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="sticky top-[34px] z-40 border border-green-500/30 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/30 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <img
              src="/hub-logo.png"
              alt="$HUB"
              className="h-6 w-6 cursor-help border border-green-500/40"
              title="H.U.B. — Headquarters for Unhinged Brokers"
            />
            <h1 className="text-sm font-bold uppercase tracking-widest text-green-400">
              $HUB :: OTC Desks Yield Optimizer
              <span className="ml-1 inline-block animate-blink text-green-500">▋</span>
            </h1>
            <EnvBadge />
          </div>
          <p className="pl-8 text-[10px] uppercase tracking-widest text-green-500/50">
            the big green button of OTC Desks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 px-3 py-1 text-[10px] text-green-500/50">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}
