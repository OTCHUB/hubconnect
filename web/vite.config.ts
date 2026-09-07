import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sdkDir = fileURLToPath(new URL("../sdk/src", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // `process.env` is referenced by anchor's node-oriented paths; stub it for the browser.
  define: { "process.env": {} },
  resolve: {
    alias: { "@hub-sdk": sdkDir },
    // One copy each so PublicKey/BN instances are interchangeable across sdk + web.
    dedupe: ["@solana/web3.js", "@coral-xyz/anchor", "bn.js", "buffer", "react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@coral-xyz/anchor", "@solana/web3.js", "buffer", "bn.js"],
    esbuildOptions: { target: "esnext" },
  },
  build: { target: "esnext" },
  // The sdk lives outside web/, so allow the dev server to serve the repo root.
  server: { fs: { allow: [repoRoot] } },
});
