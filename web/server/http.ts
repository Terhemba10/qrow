/** Small helpers shared by the fest-sprint API routes (ipfs, price, ai). */
import type { IncomingMessage, ServerResponse } from "node:http";

export const send = (res: ServerResponse, status: number, body: unknown, cacheSeconds = 0) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": cacheSeconds ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` : "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
};

/** Read a JSON body up to `max` bytes; undefined if too large or not JSON. */
export async function readJson(req: IncomingMessage, max: number): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "bad_json" }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return { ok: false, reason: "too_large" };
    chunks.push(c as Buffer);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, reason: "bad_json" };
  }
}

/**
 * Same-site browser POSTs only, so another site, or a script outside a browser, can't spend Qrow's API keys
 * (Pinata, Anthropic, Replicate). Browsers always send Origin on POST; a request without one is refused.
 * QROW_ALLOWED_ORIGINS adds origins (comma-separated), e.g. a preview deployment.
 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return process.env.QROW_ALLOW_NO_ORIGIN === "1"; // local scripts only, never set in production
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const allowed = new Set([`https://${host}`, ...(process.env.NODE_ENV === "production" ? [] : [`http://${host}`]), ...(process.env.QROW_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (req.headers["sec-fetch-site"] && !["same-origin", "same-site"].includes(String(req.headers["sec-fetch-site"])) && !allowed.has(origin)) return false;
  return allowed.has(origin);
}
