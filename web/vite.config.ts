import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// From the create-qorechain-dapp viem-wagmi template (Apache-2.0): the public REST API sends no
// CORS headers, so the browser reaches it through the dev/preview server at /lcd-testnet.
// Qrow is testnet-only, so there is no mainnet proxy.
const proxy = {
  "/lcd-testnet": {
    target: "https://api-testnet.qore.host",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/lcd-testnet/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1", proxy },
  preview: { port: 4173, host: "127.0.0.1", proxy },
});
