import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sdkDir = fileURLToPath(new URL("../sdk/src", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `process.env` is referenced by anchor's node-oriented paths; stub it for the browser.
  define: { "process.env": {} },
  resolve: {
    alias: { "@hub-sdk": sdkDir },
    // One copy each so PublicKey/BN instances are interchangeable across sdk + web.
    dedupe: ["@solana/web3.js", "@anchor-lang/core", "bn.js", "buffer", "react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@anchor-lang/core", "@solana/web3.js", "buffer", "bn.js"],
    esbuildOptions: { target: "esnext" },
  },
  // `--mode devnet` (see package.json's `build:devnet`/`deploy:devnet`) builds into its own
  // directory so the mainnet-beta (`dist`, otchub.dev/hub) and devnet (`dist-devnet`,
  // otchub.dev/devnet + otchub.dev/drip) bundles can coexist and be deployed independently by
  // wrangler's `env.production` / `env.devnet` — never overwriting each other.
  //
  // `base` is a top-level Vite option (NOT `build.base` — that key doesn't exist and is
  // silently ignored). It makes every asset reference root-absolute under the deploy mount
  // (`/hub/assets/…` or `/devnet/assets/…`) instead of plain `/assets/…`, so each bundle's
  // requests only ever land on its own Worker's route pattern (see ../wrangler.jsonc) and never
  // collide with otchub's own `/assets/*` or the other bundle's. It also rewrites `index.html`'s
  // absolute-path tags (favicon, OG/Twitter image `<meta>` tags, the `/src/main.tsx` entry
  // script) to carry the same prefix, and is exposed to app code as `import.meta.env.BASE_URL`
  // for any hardcoded root-relative asset path (see e.g. hub-logo.png references in components).
  // `workers/asset-router.ts` (production) and `workers/faucet.ts` (devnet) strip this prefix
  // again server-side before delegating to `env.ASSETS.fetch()`, since the assets binding has no
  // path-rewriting of its own.
  base: mode === "devnet" ? "/devnet/" : "/hub/",
  build: {
    target: "esnext",
    outDir: mode === "devnet" ? "dist-devnet" : "dist",
  },
  // The sdk lives outside web/, so allow the dev server to serve the repo root.
  server: { fs: { allow: [repoRoot] } },
}));
