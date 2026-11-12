/**
 * Qrow public server: one small Node process that anyone, anywhere, reaches over HTTPS.
 *   /agent/*        the agent API (src/routes.ts), rate limited per IP
 *   /lcd-testnet/*  read-only relay to QoreChain's REST API (it sends no CORS headers), GET only,
 *                   allowlisted paths, rate limited, size and time capped
 *   everything else the built web app (web/dist), with a single-page-app fallback
 * Security headers on every response. No cookies, no sessions, no user data stored.
 *
 * Env: PORT (default 8787), HOST (default 127.0.0.1; set 0.0.0.0 in a container),
 *      QROW_WEB_DIST (default ../web/dist), TRUST_PROXY=1 behind one reverse proxy,
 *      QROW_REST, CMC_API_KEY, ANTHROPIC_API_KEY, QROW_DAILY_AI_CAP.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL, hasCredentials } from "./explain.js";
import { RateLimiter, clientIp } from "./limits.js";
import { agentRoute } from "./routes.js";

const PORT = Number(process.env.PORT ?? process.env.QROW_AGENT_PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const REST = process.env.QROW_REST ?? "https://api-testnet.qore.host";
const DIST = resolve(process.env.QROW_WEB_DIST ?? join(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist"));
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

/** Only the read endpoints the app uses. Anything else (broadcast, gRPC gateways we don't need) is refused. */
const REST_ALLOW = [/^\/cosmos\/(bank|staking|distribution|auth|tx|base)\//, /^\/qorechain\//, /^\/cosmwasm\/wasm\/v1\/contract\//];
const REST_MAX_BYTES = 4 * 1024 * 1024;

const limits = {
  explain: new RateLimiter(6, 60_000), // AI calls: a few per minute per person is plenty
  agent: new RateLimiter(120, 60_000),
  rest: new RateLimiter(600, 60_000), // the app polls balances and windows
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
  "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.qore.host wss://*.qore.host https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function headers(res: ServerResponse) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (TRUST_PROXY) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
};

async function relay(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method !== "GET") return json(res, 405, { ok: false, reason: "read_only" });
  const pathname = path.split("?")[0];
  if (!REST_ALLOW.some((r) => r.test(pathname)) || pathname.includes("..")) return json(res, 403, { ok: false, reason: "path_not_allowed" });
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

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false });
  if (!existsSync(join(DIST, "index.html"))) return json(res, 404, { ok: false, reason: "web app not built (npm run build in web/)" });
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(path.split("?")[0]));
  } catch {
    return json(res, 400, { ok: false });
  }
  let file = resolve(DIST, `.${sep}${rel}`);
  if (!file.startsWith(DIST)) return json(res, 403, { ok: false });
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST, "index.html"); // client-side routes
  const isAsset = file.startsWith(join(DIST, "assets") + sep);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  headers(res);
  const url = req.url ?? "/";
  const ip = clientIp(req, TRUST_PROXY);
  try {
    if (url === "/agent" || url.startsWith("/agent/")) {
      const sub = url.slice("/agent".length) || "/";
      const bucket = sub === "/explain" ? limits.explain : limits.agent;
      if (!bucket.take(ip)) return json(res, 429, { ok: false, reason: "slow_down" }, { "retry-after": "60" });
      return await agentRoute(req, res, sub);
    }
    if (url.startsWith("/lcd-testnet/")) {
      if (!limits.rest.take(ip)) return json(res, 429, { ok: false, reason: "slow_down" }, { "retry-after": "60" });
      return await relay(req, res, url.slice("/lcd-testnet".length));
    }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(`[server] ${e instanceof Error ? e.message : "error"}`);
    if (!res.headersSent) json(res, 500, { ok: false, reason: "server_error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`qrow on http://${HOST}:${PORT} (web ${existsSync(join(DIST, "index.html")) ? DIST : "not built"}; model ${MODEL}, AI ${hasCredentials() ? "on" : "off: no ANTHROPIC_API_KEY"})`);
});
