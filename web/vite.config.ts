import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev only: serve web/api/<name>.ts (the Vercel functions) at /api/<name>, like Vercel does. */
const FUNCTIONS = new Set(["ipfs", "price", "ai"]);
function vercelFunctions(): Plugin {
  return {
    name: "qrow-vercel-functions",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = /^\/api\/([a-z]+)(?:[/?]|$)/.exec(req.url ?? "")?.[1];
        if (!name || !FUNCTIONS.has(name)) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          await mod.default(req, res);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

// From the create-qorechain-dapp viem-wagmi template (Apache-2.0): the public REST API sends no
// CORS headers, so the browser reaches it through the dev/preview server at /lcd-testnet.
// Qrow is testnet-only; the Verify page's mainnet existence check goes through Qrow's relay.
const proxy = {
  "/lcd-testnet/mainnet-check": { target: "http://127.0.0.1:8787" },
  "/lcd-testnet": {
    target: "https://api-testnet.qore.host",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/lcd-testnet/, ""),
  },
  // Qrow server (qrow/agent, npm run start): the same /agent API it serves in production.
  "/agent": { target: "http://127.0.0.1:8787" },
};

export default defineConfig({
  plugins: [react(), vercelFunctions()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1", proxy },
  preview: { port: 4173, host: "127.0.0.1", proxy },
});
