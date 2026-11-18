import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../server/http.js";
import { RateLimiter } from "../server/limits.js";
import { getKlines, getPrices, isPair, signReport } from "../server/price.js";
import { vercelIp } from "../server/vercel.js";

const hits = new RateLimiter(180, 60_000);

/**
 * GET /api/price                → every pair's price (1e8) and source
 * GET /api/price?klines=ETH/USDT → hourly candles for the chart
 * GET /api/price?report=ETH/USDT → a signed price report for QrowPerps (PRICE_SIGNER_KEY, QROW_PERPS_ADDRESS)
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { ok: false, reason: "get_only" });
  if (!hits.take(vercelIp(req))) return send(res, 429, { ok: false, reason: "slow_down" });
  const q = new URL(req.url ?? "/", "http://x").searchParams;
  try {
    const k = q.get("klines");
    if (k) {
      if (!isPair(k)) return send(res, 400, { ok: false, reason: "bad_pair" });
      return send(res, 200, { ok: true, pair: k, candles: await getKlines(k) }, 60);
    }
    const p = await getPrices();
    const rep = q.get("report");
    if (rep) {
      if (!isPair(rep)) return send(res, 400, { ok: false, reason: "bad_pair" });
      const key = process.env.PRICE_SIGNER_KEY?.trim() as `0x${string}` | undefined;
      const perps = process.env.QROW_PERPS_ADDRESS?.trim() as `0x${string}` | undefined;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !perps) return send(res, 503, { ok: false, reason: "signer_not_configured" });
      return send(res, 200, { ok: true, report: await signReport(rep, p.prices[rep], perps, key), source: p.sources[rep] });
    }
    return send(res, 200, { ok: true, at: p.at, prices: Object.fromEntries(Object.entries(p.prices).map(([k2, v]) => [k2, v.toString()])), sources: p.sources }, 5);
  } catch (e) {
    console.error("[price]", e instanceof Error ? e.message : e);
    return send(res, 502, { ok: false, reason: "price_unavailable" });
  }
}
