/** Shared bits for the Vercel functions in web/api (Node runtime). */
import type { IncomingMessage } from "node:http";
import { RateLimiter } from "./limits.js";

/**
 * The client's IP on Vercel. Vercel sets x-real-ip to the connecting client and overwrites any
 * x-forwarded-for a client sends, so neither can be spoofed from outside.
 */
export function vercelIp(req: IncomingMessage): string {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  const xff = req.headers["x-forwarded-for"];
  return (Array.isArray(xff) ? xff[0] : (xff ?? "")).split(",")[0].trim() || "unknown";
}

/** The path after a prefix, whether Vercel passes the original URL or the rewritten one. */
export function subPath(url: string | undefined, prefixes: string[]): string {
  const u = url ?? "/";
  for (const p of prefixes) if (u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}?`)) return u.slice(p.length) || "/";
  return u;
}

/**
 * Per-instance limits. Vercel may run several instances, so these slow down a single abuser on a
 * warm instance; the hard ceiling on AI spend is the Anthropic Console spend limit plus the daily cap.
 */
export const limits = {
  explain: new RateLimiter(6, 60_000),
  agent: new RateLimiter(120, 60_000),
  rest: new RateLimiter(600, 60_000),
};

/**
 * The original path and query of a rewritten request: vercel.json sends /agent/<path> and
 * /lcd-testnet/<path> to /api/agent?p=<path> and /api/lcd?p=<path>, keeping the original query
 * parameters. Returns "/<path>?<original query without p>".
 */
export function rewrittenPath(url: string | undefined): string {
  const u = new URL(url ?? "/", "http://x");
  const p = u.searchParams.get("p") ?? "";
  u.searchParams.delete("p");
  const q = u.searchParams.toString();
  return `/${p.replace(/^\/+/, "")}${q ? `?${q}` : ""}`;
}
