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

/** Hamburger / close glyphs for the mobile nav toggle in `Header.tsx`. */
export function MenuIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** GitHub mark for the footer "source ↗" link — filled, matches `XIcon`'s brand-mark style
 *  (no icon-library dependency). */
export function GithubIcon({ className = "h-4 w-4", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.58.24 2.75.12 3.04.74.81 1.18 1.84 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.53 10.53 0 0 0 23.5 12c0-6.27-5.23-11.5-11.5-11.5Z" />
    </svg>
  );
}
