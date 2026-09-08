import type { ReactNode } from "react";

// 1:1 port of otchub's fixed terminal frame bars (src/components/otc/TerminalBars.jsx) so the
// $HUB dashboard reads as the same continuous terminal session as the rest of the otchub eco.
export function TerminalTopBar({
  label = "HUB_TERMINAL",
  statusText = "LINK_ACTIVE",
  live = true,
}: {
  label?: string;
  statusText?: string;
  live?: boolean;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-2 border-b border-green-500/20 bg-black px-3 py-1.5 font-mono text-[10px] text-green-500/60 sm:text-[11px]">
      <span className="truncate">TTY1 :: {label}</span>
      {live && (
        <span className="flex shrink-0 items-center gap-1.5 text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          {statusText}
        </span>
      )}
    </div>
  );
}

export function TerminalBottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-green-500/20 bg-black px-3 py-1.5 text-center font-mono text-[10px] text-green-500/40 sm:text-[11px]">
      {children}
    </div>
  );
}
