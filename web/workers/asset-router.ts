// Thin static-asset Worker for the mainnet-beta build (see ../wrangler.jsonc's env.production).
// Before this file existed, `env.production` had no `main` script at all and was a 100%
// Cloudflare Pages-style static deploy — that only works when the Worker owns a whole hostname
// (the old app.otchub.dev Custom Domain). Now that it's mounted as a path-scoped route on the
// shared otchub.dev zone (`otchub.dev/hub*`, coexisting with otchub's own site and the devnet
// Worker), every request needs its `/hub` mount prefix stripped before `env.ASSETS.fetch()` can
// find the physical file — the assets binding has no path-rewriting of its own, and vite.config.ts
// builds this bundle with `base: "/hub/"`, so every asset tag in `index.html` already reads
// `/hub/assets/…` rather than the physical `assets/…` location in `dist/`.
//
// No `/api/*` surface here at all (unlike workers/faucet.ts) — the mainnet-beta build never talks
// to a faucet or bonding-curve backend.
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const MOUNT = "/hub";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MOUNT || url.pathname.startsWith(`${MOUNT}/`)) {
      url.pathname = url.pathname.slice(MOUNT.length) || "/";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    return env.ASSETS.fetch(request);
  },
};
