import { useUITheme } from "./hub";

// Mirrors otchub's page footer (src/pages/Home.jsx) — same copy pattern, credits, and link
// styling — so the $HUB dashboard closes out the same way every other otchub eco site does. Reads
// the global theme directly (see `ThemeProvider`) so it matches whichever chrome `Header`/`Panel`
// are currently rendering instead of staying permanently DOS-styled.
export function Footer() {
  const { theme } = useUITheme();
  const isModern = theme === "modern";
  const linkCls = isModern ? "underline hover:text-emerald-300" : "underline hover:text-green-400";
  return (
    <footer
      className={
        isModern
          ? "mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl border border-emerald-500/10 bg-white/5 px-4 py-3 text-center font-sans text-[11px] text-emerald-200/40 backdrop-blur-xl"
          : "mt-4 space-y-1 text-center text-[10px] text-green-500/30"
      }
    >
      <div className={isModern ? "w-full" : undefined}>
        {isModern
          ? "$HUB · Community tooling · Not affiliated with OTC Desks"
          : "$HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTC DESKS"}
      </div>
      <div
        className={isModern ? "flex flex-wrap items-center justify-center gap-x-1.5" : undefined}
      >
        {isModern
          ? "Data: Solana RPC (on-chain reads) · Ecosystem:"
          : "DATA: SOLANA RPC (ON-CHAIN READS) · ECOSYSTEM:"}{" "}
        <a href="https://otchub.dev" target="_blank" rel="noopener noreferrer" className={linkCls}>
          otchub.dev ↗
        </a>
        {" · "}
        <a
          href="https://fomo.otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className={linkCls}
        >
          fomo.otchub.dev ↗
        </a>
      </div>
      <div className={isModern ? "w-full" : undefined}>© 2026 otchub.dev</div>
    </footer>
  );
}
