import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("failed to load Cloudflare Turnstile"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

type Props = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  className?: string;
};

/**
 * Cloudflare Turnstile challenge widget — the bot-abuse gate in front of the devnet faucet's
 * drip / mint-desk actions (see DripPage.tsx and workers/faucet.ts's siteverify check). Renders
 * nothing when `siteKey` is empty so the app keeps working before `VITE_TURNSTILE_SITE_KEY` is
 * provisioned — callers should skip *requiring* a token in that case too (see
 * `lib/turnstile.ts`'s `TURNSTILE_SITE_KEY`).
 */
export function Turnstile({ siteKey, onVerify, onExpire, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token: string) => onVerify(token),
          "expired-callback": () => onExpire?.(),
          "error-callback": () => setError("challenge failed to load — refresh and try again"),
        });
      })
      .catch(() => setError("could not load the verification challenge"));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-render only when the site key changes
  }, [siteKey]);

  if (!siteKey) return null;
  return (
    <div className={className}>
      <div ref={ref} />
      {error && <div className="mt-1 text-[10px] text-amber-400">ERR: {error}</div>}
    </div>
  );
}
