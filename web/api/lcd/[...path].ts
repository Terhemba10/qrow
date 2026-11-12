import type { IncomingMessage, ServerResponse } from "node:http";
import { relay } from "../../server/relay.js";
import { limits, subPath, vercelIp } from "../../server/vercel.js";

/** Read-only QoreChain REST relay on Vercel: /lcd-testnet/* (rewritten here by vercel.json). */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!limits.rest.take(vercelIp(req))) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" });
    return res.end(JSON.stringify({ ok: false, reason: "slow_down" }));
  }
  return relay(req, res, subPath(req.url, ["/api/lcd", "/lcd-testnet"]));
}
