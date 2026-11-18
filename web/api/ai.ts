import type { IncomingMessage, ServerResponse } from "node:http";
import { balanceOf, chat, cleanPrompt, debit, getStore, idOf, image, parseChat, PRICES_UQOR, refund, startVideo, topUp, validKey, videoStatus } from "../server/ai.js";
import { originAllowed, readJson, send } from "../server/http.js";
import { RateLimiter } from "../server/limits.js";
import { vercelIp } from "../server/vercel.js";

const perIp = new RateLimiter(30, 60_000);
const perKey = new RateLimiter(12, 60_000);
const media = new RateLimiter(20, 3_600_000);

/**
 * POST /api/ai {op, key, ...}
 *   op "info"                      → prices, treasury, whether balances persist
 *   op "balance"                   → credit balance (uqor)
 *   op "topup", hash               → check a QoreX payment on chain and add credits
 *   op "chat", messages            → reply (costs PRICES_UQOR.chat)
 *   op "image", prompt             → image URL (costs .image)
 *   op "video", prompt             → prediction id (costs .video); then op "video-status", id
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { ok: false, reason: "post_only" });
  if (!originAllowed(req)) return send(res, 403, { ok: false, reason: "origin" });
  if (!perIp.take(vercelIp(req))) return send(res, 429, { ok: false, reason: "slow_down" });
  const body = await readJson(req, 40_000);
  if (!body.ok) return send(res, 400, { ok: false, reason: body.reason });
  const b = (body.value ?? {}) as Record<string, unknown>;
  const store = getStore();
  const treasury = process.env.AI_TREASURY_QOR?.trim();
  const prices = Object.fromEntries(Object.entries(PRICES_UQOR).map(([k, v]) => [k, v.toString()]));

  if (b.op === "info")
    return send(res, 200, {
      ok: true,
      prices,
      treasury: treasury ?? null,
      persistent: store.persistent,
      enabled: { chat: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), image: !!process.env.REPLICATE_API_TOKEN, video: !!process.env.REPLICATE_API_TOKEN },
    });

  if (!validKey(b.key)) return send(res, 400, { ok: false, reason: "bad_key" });
  const id = idOf(b.key);
  if (!perKey.take(id)) return send(res, 429, { ok: false, reason: "slow_down" });

  try {
    if (b.op === "balance") return send(res, 200, { ok: true, balance: (await balanceOf(store, id)).toString() });

    if (b.op === "topup") {
      if (!treasury) return send(res, 503, { ok: false, reason: "treasury_not_configured" });
      const r = await topUp(store, String(b.hash ?? ""), id, treasury);
      return r.ok ? send(res, 200, { ok: true, credited: r.credited.toString(), balance: r.balance.toString() }) : send(res, r.reason === "not_found_yet" ? 409 : 400, r);
    }

    if (b.op === "video-status") {
      const pid = String(b.id ?? "");
      if (!(await store.has(`qrow:ai:vid:${pid}:${id}`))) return send(res, 403, { ok: false, reason: "not_yours" });
      const s = await videoStatus(pid);
      if (s.status === "failed" && (await store.setOnce(`qrow:ai:vidrefund:${pid}`, id))) await refund(store, id, PRICES_UQOR.video);
      return send(res, 200, { ok: true, ...s, balance: (await balanceOf(store, id)).toString() });
    }

    const op = b.op;
    if (op !== "chat" && op !== "image" && op !== "video") return send(res, 400, { ok: false, reason: "bad_op" });
    const price = PRICES_UQOR[op];
    const messages = op === "chat" ? parseChat(b.messages) : undefined;
    const prompt = op === "chat" ? "" : cleanPrompt(b.prompt);
    if (op === "chat" ? !messages : prompt.length < 3) return send(res, 400, { ok: false, reason: "bad_input" });
    if (op !== "chat" && !media.take(vercelIp(req))) return send(res, 429, { ok: false, reason: "slow_down" });
    if (!(await debit(store, id, price))) return send(res, 402, { ok: false, reason: "not_enough_credits", balance: (await balanceOf(store, id)).toString() });
    try {
      if (op === "chat") return send(res, 200, { ok: true, reply: await chat(messages!), balance: (await balanceOf(store, id)).toString() });
      if (op === "image") return send(res, 200, { ok: true, url: await image(prompt), balance: (await balanceOf(store, id)).toString() });
      const pid = await startVideo(prompt);
      await store.setOnce(`qrow:ai:vid:${pid}:${id}`, "1");
      return send(res, 200, { ok: true, id: pid, balance: (await balanceOf(store, id)).toString() });
    } catch (e) {
      await refund(store, id, price);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ai] ${op}`, msg);
      return send(res, msg === "no_key" ? 503 : 502, { ok: false, reason: msg === "no_key" ? "provider_not_configured" : "provider_failed", refunded: true });
    }
  } catch (e) {
    console.error("[ai]", e instanceof Error ? e.message : e);
    return send(res, 502, { ok: false, reason: "unavailable" });
  }
}
