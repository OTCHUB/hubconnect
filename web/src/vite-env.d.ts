/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUB_RPC_URL?: string;
  readonly VITE_HUB_PROGRAM_ID?: string;
  readonly VITE_HUB_CLUSTER?: string;
  /** Historical-metrics feed (web/src/hub/lib/supabaseHistory.ts) — anon key, read-only. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
