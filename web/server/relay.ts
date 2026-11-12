/**
 * Read-only relay to QoreChain's REST API (it sends no CORS headers, so browsers can't call it
 * directly). GET only, allowlisted paths, 15 s timeout, 4 MB cap. It cannot broadcast anything.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const REST = process.env.QROW_REST ?? "https://api-testnet.qore.host";
/** Only the read endpoints the app uses. */
const REST_ALLOW = [/^\/cosmos\/(bank|staking|distribution|auth|tx|base)\//, /^\/qorechain\//, /^\/cosmwasm\/wasm\/v1\/contract\//];
const REST_MAX_BYTES = 4 * 1024 * 1024;

export const restPathAllowed = (path: string) => {
  const pathname = path.split("?")[0];
  return REST_ALLOW.some((r) => r.test(pathname)) && !pathname.includes("..") && !/%2e/i.test(pathname);
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export async function relay(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET") return json(res, 405, { ok: false, reason: "read_only" });
  if (!restPathAllowed(path)) return json(res, 403, { ok: false, reason: "path_not_allowed" });
  try {
    const up = await fetch(`${REST}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const buf = Buffer.from(await up.arrayBuffer());
    if (buf.length > REST_MAX_BYTES) return json(res, 502, { ok: false, reason: "too_large" });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    res.end(buf);
  } catch {
    json(res, 504, { ok: false, reason: "chain_unavailable" });
  }
}
