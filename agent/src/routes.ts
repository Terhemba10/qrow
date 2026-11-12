/**
 * Qrow agent API, mounted at /agent by the public server (src/server.ts):
 *   POST /explain          { token, amount, mode, checks[] } -> { ok, text } | { ok: false, reason }
 *   GET  /market/prices    cached CoinMarketCap quotes ("Data from CoinMarketCap")
 *   GET  /market/news      cached RSS headlines (title, source, date, link only)
 *   GET  /referrals/:qor   distinct stakers who used a referral memo (tracking only)
 *   GET  /health
 * Keys stay on the server. Logs timings and token usage, never request contents or keys.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { MODEL, explain, hasCredentials, parseRequest } from "./explain.js";
import { isQorAddress, referralCount } from "./referrals.js";
import { news, prices } from "./market.js";
import { watcherState } from "./state.js";

const MAX_BODY = 16 * 1024;
/** Hard ceiling on AI calls per UTC day across all users, so a flood can't run up the bill. */
const DAILY_AI_CAP = Number(process.env.QROW_DAILY_AI_CAP ?? 2000);
let day = "";
let spent = 0;
function spendOk(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    spent = 0;
  }
  if (spent >= DAILY_AI_CAP) return false;
  spent += 1;
  return true;
}

export async function agentRoute(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && url === "/health") return send(200, { ok: true, model: MODEL, ai: hasCredentials(), watcher: watcherState.enabled ? (watcherState.running ? "running" : "restarting") : "off" });
  if (req.method === "GET" && url === "/market/prices") {
    try {
      return send(200, { ok: true, ...(await prices()), attribution: "Data from CoinMarketCap" });
    } catch (e) {
      return send(e instanceof Error && e.message === "no_key" ? 503 : 502, { ok: false, reason: e instanceof Error && e.message === "no_key" ? "no_key" : "upstream" });
    }
  }
  if (req.method === "GET" && url === "/market/news") {
    return send(200, { ok: true, ...(await news()) });
  }
  if (req.method === "GET" && url?.startsWith("/referrals/")) {
    const ref = decodeURIComponent(url.slice("/referrals/".length));
    if (!isQorAddress(ref)) return send(400, { ok: false, reason: "bad_address" });
    try {
      const r = await referralCount(ref);
      return send(200, { ok: true, count: r.count });
    } catch {
      return send(502, { ok: false, reason: "chain_unavailable" });
    }
  }
  if (req.method !== "POST" || url !== "/explain") return send(404, { ok: false, reason: "not_found" });

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return send(413, { ok: false, reason: "too_large" });
    chunks.push(c as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(400, { ok: false, reason: "bad_json" });
  }
  const input = parseRequest(parsed);
  if (!input) return send(400, { ok: false, reason: "bad_request" });

  if (!spendOk()) return send(429, { ok: false, reason: "daily_cap" });
  const result = await explain(input);
  console.log(
    `[explain] ${result.ok ? "ok" : result.reason} ${result.ms}ms` +
      (result.ok ? ` in=${result.usage.input} cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite} out=${result.usage.output}` : ""),
  );
  send(200, result);
}
