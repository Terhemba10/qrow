import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../server/http.js";
import { keeperConfig, keeperPass } from "../server/keeper.js";

/** Vercel: up to 60 s for one pass (a trigger waits for its receipt; opening a window adds ~10 s). */
export const config = { maxDuration: 60 };

/** Constant-time check of "Authorization: Bearer <KEEPER_CRON_SECRET>". */
export function cronAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 24 || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

let running = false;

/**
 * GET /api/keeper (Authorization: Bearer KEEPER_CRON_SECRET) → one keeper pass over QrowPerps.
 * Called every minute by a free external timer (cron-job.org); anything without the secret gets 401.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { ok: false, reason: "get_only" });
  if (!cronAuthorized(req.headers.authorization, process.env.KEEPER_CRON_SECRET?.trim())) return send(res, 401, { ok: false, reason: "unauthorized" });
  const cfg = keeperConfig();
  if (!cfg.ok) {
    console.error(`[keeper] not configured, missing: ${cfg.missing.join(", ")}`);
    return send(res, 503, { ok: false, reason: "not_configured", missing: cfg.missing });
  }
  if (running) return send(res, 200, { ok: true, skipped: "previous pass still running" });
  running = true;
  try {
    const r = await keeperPass(cfg.config, (s) => console.log(`[keeper] ${s}`));
    return send(res, 200, { ok: true, open: r.open, withTpSl: r.withTpSl, actions: r.actions });
  } catch (e) {
    console.error(`[keeper] pass failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return send(res, 502, { ok: false, reason: "pass_failed" });
  } finally {
    running = false;
  }
}
