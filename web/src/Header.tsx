import { NavLink } from "react-router-dom";
import { rpcHost, useHub } from "./hub";

const linkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive ? "bg-green-500/15 text-green-200" : "text-green-600 hover:text-green-300";
  return `px-2 py-0.5 tracking-widest ${tone}`;
};

export function Header() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="border border-green-500/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/30 px-3 py-2">
        <div className="text-sm tracking-widest text-green-300">
          $HUB :: TREASURY DASHBOARD &amp; YIELD TRACKER
          <span className="animate-blink">_</span>
        </div>
        <nav className="flex gap-1 text-[10px]">
          <NavLink to="/hub" end className={linkCls}>
            DASHBOARD
          </NavLink>
          <NavLink to="/hub/treasury" className={linkCls}>
            TREASURY
          </NavLink>
        </nav>
      </div>
      <div className="flex flex-wrap gap-x-4 px-3 py-1 text-[10px] text-green-700">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}
