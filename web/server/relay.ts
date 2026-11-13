/**
 * Relay to QoreChain's REST API (it sends no CORS headers, so browsers can't call it directly).
 * - GET: allowlisted read paths only, 15 s timeout, 4 MB cap.
 * - POST: only broadcasting an already-signed transaction (`/cosmos/tx/v1beta1/txs`) and simulating one
 *   (`/cosmos/tx/v1beta1/simulate`), body at most 128 KB. The relay never signs anything and holds no
 *   keys: it forwards bytes the user's own device signed, exactly as a wallet would.
 * - GET /mainnet-check/<hash>: does this transaction hash exist on QoreChain mainnet? Answers only
 *   {found, height} (for the Verify page, which flags mainnet hashes; Qrow itself is testnet only).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const REST = process.env.QROW_REST ?? "https://api-testnet.qore.host";
/** Only the read endpoints the app uses. */
const REST_ALLOW = [/^\/cosmos\/(bank|staking|distribution|auth|tx|base|authz)\//, /^\/qorechain\//, /^\/cosmwasm\/wasm\/v1\/contract\//];
const POST_ALLOW = new Set(["/cosmos/tx/v1beta1/txs", "/cosmos/tx/v1beta1/simulate"]);
const MAINNET_REST = "https://api.qore.host";
const MAINNET_CHECK = /^\/mainnet-check\/([0-9A-F]{64})$/;
export const mainnetCheckHash = (path: string) => MAINNET_CHECK.exec(path)?.[1];
const REST_MAX_BYTES = 4 * 1024 * 1024;
const POST_MAX_BYTES = 128 * 1024;

export const restPathAllowed = (path: string) => {
  const pathname = path.split("?")[0];
  return REST_ALLOW.some((r) => r.test(pathname)) && !pathname.includes("..") && !/%2e/i.test(pathname);
};
export const postPathAllowed = (path: string) => POST_ALLOW.has(path);

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > POST_MAX_BYTES) return undefined;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function relay(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const mainnetHash = req.method === "GET" ? mainnetCheckHash(path) : undefined;
  if (mainnetHash) return mainnetCheck(res, mainnetHash);
  let init: RequestInit;
  if (req.method === "GET") {
    if (!restPathAllowed(path)) return json(res, 403, { ok: false, reason: "path_not_allowed" });
    init = { headers: { accept: "application/json" } };
  } else if (req.method === "POST") {
    if (!postPathAllowed(path)) return json(res, 403, { ok: false, reason: "path_not_allowed" });
    const body = await readBody(req);
    if (!body) return json(res, 413, { ok: false, reason: "too_large" });
    try {
      const j = JSON.parse(body.toString("utf8")) as { tx_bytes?: unknown; mode?: unknown };
      if (typeof j.tx_bytes !== "string" || !/^[A-Za-z0-9+/=]+$/.test(j.tx_bytes)) return json(res, 400, { ok: false, reason: "bad_tx" });
    } catch {
      return json(res, 400, { ok: false, reason: "bad_json" });
    }
    init = { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: body.toString("utf8") };
  } else {
    return json(res, 405, { ok: false, reason: "method_not_allowed" });
  }
  try {
    const up = await fetch(`${REST}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    const buf = Buffer.from(await up.arrayBuffer());
    if (buf.length > REST_MAX_BYTES) return json(res, 502, { ok: false, reason: "too_large" });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    res.end(buf);
  } catch {
    json(res, 504, { ok: false, reason: "chain_unavailable" });
  }
}

/** Existence only: never relays mainnet content. */
async function mainnetCheck(res: ServerResponse, hash: string): Promise<void> {
  try {
    const up = await fetch(`${MAINNET_REST}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!up.ok) return json(res, 200, { found: false });
    const j = (await up.json().catch(() => ({}))) as { tx_response?: { height?: string } };
    return json(res, 200, j.tx_response ? { found: true, height: Number(j.tx_response.height) } : { found: false });
  } catch {
    json(res, 504, { ok: false, reason: "chain_unavailable" });
  }
}
