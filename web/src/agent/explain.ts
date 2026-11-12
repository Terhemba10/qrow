import { AGENT } from "../config/network";
import type { AgentRun } from "./checks";
import type { PaymentDraft } from "../lib/draft";
import { formatUnitsExact } from "../lib/amount";
import type { Token } from "../config/tokens";

export type Explanation =
  | { ok: true; text: string; ms: number; model: string }
  | { ok: false; reason: "no_key" | "timeout" | "rate_limited" | "refused" | "error" | "offline"; ms: number };

/** Hard ceiling for the whole round trip; the warnings never wait for it. */
export const EXPLAIN_TIMEOUT_MS = 5_000;

const ADDRESS = /0x[0-9a-fA-F]{40}|qor1[02-9ac-hj-np-z]{38}/g;

/**
 * Exactly what leaves the browser: the check results (addresses replaced with "[address]"), the
 * token, the amount and the mode. Never the recipient address, the note or any QR text.
 */
export function explainPayload(run: AgentRun, draft: PaymentDraft, token: Token) {
  return {
    token: token.symbol,
    amount: formatUnitsExact(BigInt(draft.amountUnits), token.decimals),
    mode: draft.freelancer ? "release" : "claim",
    checks: run.results.map((r) => ({
      id: r.id,
      level: r.level,
      title: r.title.replace(ADDRESS, "[address]"),
      ...(r.detail ? { detail: r.detail.replace(ADDRESS, "[address]").slice(0, 600) } : {}),
    })),
  };
}

export async function fetchExplanation(run: AgentRun, draft: PaymentDraft, token: Token): Promise<Explanation> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXPLAIN_TIMEOUT_MS);
  try {
    const res = await fetch(`${AGENT}/explain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(explainPayload(run, draft, token)),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, reason: "offline", ms: Math.round(performance.now() - t0) };
    const r = (await res.json()) as Explanation;
    return r.ok ? { ...r, ms: Math.round(performance.now() - t0) } : r;
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "offline", ms: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
  }
}
