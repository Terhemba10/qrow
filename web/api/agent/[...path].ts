import type { IncomingMessage, ServerResponse } from "node:http";
import { agentRoute } from "../../server/routes.js";
import { limits, subPath, vercelIp } from "../../server/vercel.js";

/** Qrow agent API on Vercel: /agent/* (rewritten here by vercel.json). */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const sub = subPath(req.url, ["/api/agent", "/agent"]);
  const bucket = sub === "/explain" ? limits.explain : limits.agent;
  if (!bucket.take(vercelIp(req))) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" });
    return res.end(JSON.stringify({ ok: false, reason: "slow_down" }));
  }
  return agentRoute(req, res, sub);
}
