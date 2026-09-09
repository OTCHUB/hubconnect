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
  // directory so the mainnet-beta (`dist`, app.otchub.dev) and devnet (`dist-devnet`,
  // devnet.otchub.dev) bundles can coexist and be deployed independently by wrangler's
  // `env.production` / `env.devnet` — never overwriting each other.
  build: { target: "esnext", outDir: mode === "devnet" ? "dist-devnet" : "dist" },
  // The sdk lives outside web/, so allow the dev server to serve the repo root.
  server: { fs: { allow: [repoRoot] } },
}));
