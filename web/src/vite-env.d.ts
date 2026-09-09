/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUB_RPC_URL?: string;
  readonly VITE_HUB_PROGRAM_ID?: string;
  readonly VITE_HUB_CLUSTER?: string;
  /** Historical-metrics feed (web/src/hub/lib/supabaseHistory.ts) — anon key, read-only. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Cloudflare Turnstile public site key — gates the devnet faucet's drip/mint-desk actions
   *  (web/src/hub/routes/DripPage.tsx, workers/faucet.ts). Unset = widget/verification skipped. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
