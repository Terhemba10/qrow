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
 * Same-site POSTs only: a browser on another site can't spend Qrow's API keys. Requests without an Origin
 * (curl, server-to-server) are allowed through to the rate limit; QROW_ALLOWED_ORIGINS adds origins.
 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const allowed = new Set([`https://${host}`, `http://${host}`, ...(process.env.QROW_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  return allowed.has(origin);
}
