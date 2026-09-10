import type { SVGProps } from "react";

/**
 * Minimal stroke-icon set — replaces the decorative emoji (⚡ 🔐 🧺 💧) that used to sit in the
 * header, Wallet Connect, and M.I.M ETF chrome. Plain inline SVGs (no icon-library dependency),
 * single `currentColor` stroke so each call site can tint them via `className`.
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

/** X (formerly Twitter) glyph — filled, not stroked (matches the brand mark), single-color via
 *  `currentColor` so it tints via `className` like the rest of the set. */
export function XIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M18.9 2.4h3.3l-7.2 8.2 8.5 11.2h-6.6l-5.2-6.8-5.9 6.8H2.4l7.7-8.8L1.9 2.4h6.8l4.7 6.2 5.5-6.2Zm-1.2 17.4h1.8L7.4 4.1H5.5l12.2 15.7Z" />
    </svg>
  );
}

/** Sun/moon glyphs for the icon-only dark/light toggle (no text label). */
export function SunIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}
