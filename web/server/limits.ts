import type { IncomingMessage } from "node:http";

/** Fixed-window limiter per key, in memory (one process). Old entries are swept as it goes. */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (now - v.start > this.windowMs) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || now - h.start > this.windowMs) {
      this.hits.set(key, { start: now, n: 1 });
      return true;
    }
    if (h.n >= this.max) return false;
    h.n += 1;
    return true;
  }
}

/**
 * The caller's IP. Behind exactly one trusted reverse proxy (TRUST_PROXY=1) the proxy appends the
 * real client to X-Forwarded-For, so the LAST entry is the one it vouches for; earlier entries are
 * whatever the client claimed and can't be trusted.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Browser origins allowed to call the API cross-origin: an explicit list (QROW_ALLOWED_ORIGINS,
 * comma-separated) plus the Cloudflare Pages project and its preview deployments
 * (https://<project>.pages.dev and https://<preview>.<project>.pages.dev). Same origin always works.
 */
export function makeOriginCheck(list: string | undefined, pagesProject: string | undefined): (origin: string) => boolean {
  const allowed = new Set((list ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean));
  const project = (pagesProject ?? "").replace(/[^a-z0-9-]/g, "");
  return (origin) => {
    if (allowed.has(origin)) return true;
    if (!project || !origin.startsWith("https://")) return false;
    const h = origin.slice("https://".length);
    const suffix = `.${project}.pages.dev`;
    return h === `${project}.pages.dev` || (h.endsWith(suffix) && /^[a-z0-9-]+$/.test(h.slice(0, -suffix.length)));
  };
}
