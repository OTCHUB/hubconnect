import { NavLink } from "react-router-dom";
import { EnvBadge, rpcHost, useHub } from "./hub";

// otchub header buttons: bordered, uppercase, green-500/50 outline, tinted when active.
const linkCls = ({ isActive }: { isActive: boolean }) => {
  const tone = isActive
    ? "border-green-400 bg-green-500/15 text-green-200"
    : "border-green-500/50 text-green-400 hover:bg-green-500/10";
  return `inline-flex items-center whitespace-nowrap border px-2 py-1 text-[10px] tracking-widest sm:px-2.5 ${tone}`;
};

export function Header() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="border border-green-500/30 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-bold uppercase tracking-widest text-green-400">
            $HUB :: TREASURY DASHBOARD &amp; YIELD TRACKER
            <span className="ml-1 inline-block animate-blink text-green-500">▋</span>
          </h1>
          <EnvBadge />
        </div>
        <nav className="flex flex-wrap gap-1.5">
          <NavLink to="/hub" end className={linkCls}>
            DASHBOARD
          </NavLink>
          <NavLink to="/hub/treasury" className={linkCls}>
            TREASURY
          </NavLink>
          <NavLink to="/hub/tokenomics" className={linkCls}>
            TOKENOMICS
          </NavLink>
          <NavLink to="/hub/deployments" className={linkCls}>
            DEPLOYMENTS
          </NavLink>
        </nav>
      </div>
      <div className="flex flex-wrap gap-x-4 px-3 py-1 text-[10px] text-green-500/50">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}
