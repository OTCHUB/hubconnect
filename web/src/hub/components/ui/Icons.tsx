import type { SVGProps } from "react";

/**
 * Minimal stroke-icon set — replaces the decorative emoji (⚡ 🔐 🧺 💧 ✨ 🖥) that used to sit in
 * the header, Wallet Connect, and M.I.M ETF chrome. Plain inline SVGs (no icon-library
 * dependency), single `currentColor` stroke so each call site can tint them via `className` and
 * they read correctly in both the retro (green-on-black) and modern (white/emerald) themes.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke">;

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function BoltIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function LockIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <rect x="4" y="11" width="16" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function BasketIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="m4 10 2-5h12l2 5" />
      <path d="M4 10h16l-1.4 8.4a2 2 0 0 1-2 1.6H7.4a2 2 0 0 1-2-1.6L4 10Z" />
      <path d="M9.5 10 9 5M14.5 10l.5-5M12 10v9" />
    </svg>
  );
}

export function DropletIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />
    </svg>
  );
}

export function SparkleIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

export function MonitorIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
