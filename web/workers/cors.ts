// Shared CORS handling for the devnet Worker (workers/faucet.ts + the /api/curve/* routes it
// mounts from bonding-curve.ts). Both otchub/src/hub/lib/faucet.ts and curve.ts always call
// https://otchub.dev (this Worker's own origin — see ../wrangler.jsonc's env.devnet routes:
// otchub.dev/api/faucet/*, otchub.dev/api/curve/*), which is same-origin once otchub.dev's own
// site links straight to otchub.dev/devnet + /drip. These headers still matter whenever the
// module is loaded from a genuinely different origin — a local Vite dev server, a Base44 preview
// deploy, or this repo's own standalone shell before it's fully retired — since every request
// becomes cross-origin there and needs these headers or the browser blocks it before it ever
// reaches the routes below. Every client call sets `content-type: application/json`, which is
// never a CORS-"simple" header, so *every* GET and POST here (not just mutating ones) triggers a
// preflight OPTIONS request first.
//
// Origin allowlist is env-driven (`ALLOWED_ORIGINS`, comma-separated — see wrangler.jsonc) so it
// can be extended (a Base44 preview URL, a local dev port) without a code change/redeploy of the
// Worker's compiled logic. Falls back to the known otchub hosts + common local dev ports when the
// var is unset, so this keeps working even before someone provisions it.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://otchub.dev",
  "https://www.otchub.dev",
  "http://localhost:5173",
  "http://localhost:3000",
];

export interface CorsEnv {
  /** Comma-separated allowlist, e.g. "https://otchub.dev,https://preview-xyz.base44.app". */
  ALLOWED_ORIGINS?: string;
}

function allowedOrigins(env: CorsEnv): string[] {
  if (!env.ALLOWED_ORIGINS) return DEFAULT_ALLOWED_ORIGINS;
  return env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Null when the request has no Origin header (same-origin/non-browser) or it isn't allowlisted —
 *  callers should omit the CORS headers entirely in that case rather than send a wildcard/echo. */
export function resolveAllowedOrigin(request: Request, env: CorsEnv): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

/** Handles an `/api/*` OPTIONS preflight. 204 + headers when the origin is allowlisted, otherwise
 *  a plain 403 with no CORS headers (browser reports it as a CORS failure either way, but this
 *  keeps disallowed origins from ever learning which methods/headers this API accepts). */
export function preflightResponse(allowedOrigin: string | null): Response {
  if (!allowedOrigin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "origin",
    },
  });
}

/** Wraps an already-built JSON Response with CORS headers for an allowlisted origin. No-op (and
 *  no `access-control-allow-origin`) when `allowedOrigin` is null, matching `preflightResponse`. */
export function withCors(response: Response, allowedOrigin: string | null): Response {
  if (!allowedOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("vary", "origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
