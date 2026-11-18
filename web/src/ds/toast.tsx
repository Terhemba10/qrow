/**
 * TxStatusToast: pending → confirmed → failed for every transaction, visible on any tab until dismissed
 * (UX-AUDIT #7, #8). Failures always say what happened and offer one fix. Announced politely to screen readers.
 */
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { EXPLORER_TX } from "../lib/tx";

export type TxState = "pending" | "confirmed" | "failed";
export interface TxToast {
  id: string;
  state: TxState;
  title: string;
  text?: string;
  hash?: string;
  /** One fix for a failure: a link inside Qrow, or an external URL. */
  fix?: { label: string; to?: string; href?: string };
}

let toasts: TxToast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const timers = new Map<string, number>();

/** Add or update a toast by id. Confirmed toasts close themselves after 8 s; pending and failed stay. */
export function txToast(t: TxToast) {
  toasts = toasts.some((x) => x.id === t.id) ? toasts.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [...toasts, t].slice(-4);
  window.clearTimeout(timers.get(t.id));
  if (t.state === "confirmed") timers.set(t.id, window.setTimeout(() => dismissToast(t.id), 8000));
  emit();
}
export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
const useToasts = () =>
  useSyncExternalStore(
    (s) => (subs.add(s), () => subs.delete(s)),
    () => toasts,
    () => toasts,
  );

/**
 * Plain-English error + one fix, from whatever the wallet or chain said. Unknown errors keep a short version of
 * the original text so nothing is hidden.
 */
export function explainTxError(raw: unknown): { text: string; fix?: TxToast["fix"] } {
  const m = raw instanceof Error ? raw.message : String(raw);
  if (/reject|denied|cancel/i.test(m)) return { text: "You cancelled in QoreX. Nothing was sent." };
  if (/insufficient (fee|funds)|not enough qor|need about .* QOR/i.test(m)) return { text: "Not enough test QOR for the network fee.", fix: { label: "Get free test QOR", to: "/faucet" } };
  if (/less than|not enough|balance/i.test(m)) return { text: "Your balance is too low for this.", fix: { label: "Get test tokens", to: "/faucet" } };
  if (/window/i.test(m)) return { text: "Qrow’s access window in QoreX is closed or used up.", fix: { label: "How to open it", to: "/help#window" } };
  if (/sequence|in progress/i.test(m)) return { text: "Another transaction was still finishing.", fix: { label: "Try again in a few seconds" } };
  if (/price|slippage|limit/i.test(m)) return { text: "The price moved too much while you were confirming. Nothing was traded." };
  if (/timed? ?out|not confirmed yet/i.test(m)) return { text: "Sent, but the network hasn’t confirmed it yet. Check History in a minute.", fix: { label: "Open History", to: "/history" } };
  if (/reverted|refused/i.test(m)) return { text: "The contract refused it, so nothing moved except the network fee.", fix: { label: "See what to check", to: "/help" } };
  return { text: m.length > 140 ? `${m.slice(0, 140)}…` : m };
}

function Icon({ state }: { state: TxState }) {
  if (state === "pending") return <span className="q-btn__spin" aria-hidden="true" />;
  return state === "confirmed" ? (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const WORD: Record<TxState, string> = { pending: "Waiting for the network", confirmed: "Confirmed", failed: "Didn’t go through" };

/** Mounted once in App. */
export function TxToastHost() {
  const list = useToasts();
  return (
    <div className="q-toasts" aria-live="polite" aria-relevant="additions text">
      {list.map((t) => (
        <div key={t.id} className={`q-toast q-toast--${t.state}`} role={t.state === "failed" ? "alert" : "status"}>
          <span className="q-toast__icon">
            <Icon state={t.state} />
          </span>
          <div>
            <div className="q-toast__title">
              {t.title}: {WORD[t.state]}
            </div>
            {t.text && <div className="q-toast__text">{t.text}</div>}
            {(t.hash || t.fix) && (
              <div className="q-toast__links">
                {t.fix?.to && <Link to={t.fix.to}>{t.fix.label}</Link>}
                {t.fix?.href && (
                  <a href={t.fix.href} target="_blank" rel="noopener noreferrer">
                    {t.fix.label}
                  </a>
                )}
                {t.fix && !t.fix.to && !t.fix.href && <span className="q-toast__text">{t.fix.label}</span>}
                {t.hash && (
                  <a href={EXPLORER_TX(t.hash)} target="_blank" rel="noopener noreferrer">
                    View on explorer
                  </a>
                )}
              </div>
            )}
          </div>
          <button className="q-toast__close" type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
