import type { IncomingMessage, ServerResponse } from "node:http";
import { originAllowed, readJson, send } from "../server/http.js";
import { parseNftRequest, pinNft } from "../server/ipfs.js";
import { RateLimiter } from "../server/limits.js";
import { vercelIp } from "../server/vercel.js";

/** 10 uploads per IP per hour on a warm instance (Pinata's own quota is the hard ceiling). */
const uploads = new RateLimiter(10, 3_600_000);

/** POST /api/ipfs {name, description, supply, creator, image: data URL} → {metadataUri, imageCid}. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { ok: false, reason: "post_only" });
  if (!originAllowed(req)) return send(res, 403, { ok: false, reason: "origin" });
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) return send(res, 503, { ok: false, reason: "ipfs_not_configured" });
  if (!uploads.take(vercelIp(req))) return send(res, 429, { ok: false, reason: "slow_down" });
  const body = await readJson(req, 4_400_000);
  if (!body.ok) return send(res, body.reason === "too_large" ? 413 : 400, { ok: false, reason: body.reason });
  const parsed = parseNftRequest(body.value);
  if (!parsed.ok) return send(res, 400, { ok: false, reason: parsed.reason });
  try {
    const r = await pinNft(parsed.input, jwt);
    return send(res, 200, { ok: true, ...r });
  } catch (e) {
    console.error("[ipfs]", e instanceof Error ? e.message : e);
    return send(res, 502, { ok: false, reason: "ipfs_failed" });
  }
}
