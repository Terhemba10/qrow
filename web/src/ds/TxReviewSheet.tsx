/**
 * TxReviewSheet: the ONE review screen before every transaction (owner's brief, UX-AUDIT #1, #2).
 * What you send, what you get, one total fee (tap for the breakdown), the recipient, the network, then a single
 * "Confirm in QoreX". A bottom sheet on phones, a centred dialog on wider screens. Escape or the backdrop cancels;
 * focus moves into the sheet and back to the opener when it closes.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { AddressChip, Button, NetworkBadge, TokenAmount } from "./primitives";

export interface Amount {
  units: bigint;
  decimals: number;
  symbol: string;
}

export interface FeeLine {
  label: string;
  amount: Amount;
}

export interface TxReview {
  title: string;
  /** What leaves the user's wallet (none for e.g. a claim). */
  send?: Amount[];
  /** What the user gets (estimated where marked). */
  get?: (Amount & { estimate?: boolean })[];
  /** Total network fee and its parts (all in test QOR). */
  fee?: { total: Amount; lines?: FeeLine[]; estimate?: boolean };
  recipient?: { label: string; address: string };
  /** Extra facts that matter for this action (e.g. "Refund after 7 days"). */
  facts?: { name: string; value: ReactNode }[];
  warning?: ReactNode;
}

export function TxReviewSheet(props: {
  open: boolean;
  review: TxReview;
  confirmLabel?: string;
  busy?: boolean;
  /** Shown above the button while working, e.g. "Approve in QoreX…". */
  busyText?: string;
  /** A blocker or error with its fix (replaces the confirm button's enabled state). */
  problem?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Context shown under the title (e.g. the big recipient check on NFT sends). */
  children?: ReactNode;
  /** Hide the confirm button (e.g. while a guide replaces it). */
  hideConfirm?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!props.open) return;
    opener.current = document.activeElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !props.busy) props.onCancel();
      if (e.key === "Tab" && ref.current) {
        // Keep focus inside the sheet.
        const f = ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary, [tabindex='0']");
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [props.open, props.busy, props.onCancel]);

  if (!props.open) return null;
  const r = props.review;
  return (
    <div className="q-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !props.busy && props.onCancel()}>
      <div className="q-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="q-sheet__grab" aria-hidden="true" />
        <h2 className="q-sheet__title" id={titleId}>
          {r.title}
        </h2>
        {props.children && <div className="q-sheet__intro">{props.children}</div>}
        <dl className="q-sheet__rows">
          {r.send?.map((a, i) => (
            <div className="q-sheet__row" key={`s${i}`}>
              <dt>{i === 0 ? "You send" : "And"}</dt>
              <dd className="q-sheet__big">
                <TokenAmount {...a} />
              </dd>
            </div>
          ))}
          {r.get?.map((a, i) => (
            <div className="q-sheet__row" key={`g${i}`}>
              <dt>{i === 0 ? (a.estimate ? "You get (about)" : "You get") : "And"}</dt>
              <dd className="q-sheet__big">
                <TokenAmount {...a} />
              </dd>
            </div>
          ))}
          {r.recipient && (
            <div className="q-sheet__row">
              <dt>{r.recipient.label}</dt>
              <dd>
                <AddressChip address={r.recipient.address} label={r.recipient.label} />
              </dd>
            </div>
          )}
          {r.facts?.map((f) => (
            <div className="q-sheet__row" key={f.name}>
              <dt>{f.name}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
          <div className="q-sheet__row">
            <dt>Network</dt>
            <dd>
              <NetworkBadge />
            </dd>
          </div>
        </dl>
        {r.fee && (
          <details className="q-sheet__fee q-sheet__rows">
            <summary>
              <span className="q-muted">{r.fee.estimate ? "Network fee (estimate)" : "Network fee"}</span>
              <span>
                <TokenAmount {...r.fee.total} maxDecimals={4} />{" "}
                {r.fee.lines && r.fee.lines.length > 0 && (
                  <svg className="q-sheet__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                )}
              </span>
            </summary>
            {r.fee.lines && r.fee.lines.length > 0 && (
              <ul>
                {r.fee.lines.map((l) => (
                  <li key={l.label}>
                    <span>{l.label}</span>
                    <TokenAmount {...l.amount} maxDecimals={4} />
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        {r.warning && (
          <p className="q-sheet__warn" role="note">
            {r.warning}
          </p>
        )}
        <div className="q-sheet__actions">
          {props.problem}
          {props.busy && props.busyText && (
            <p className="q-muted" role="status" style={{ textAlign: "center", margin: 0 }}>
              {props.busyText}
            </p>
          )}
          {!props.hideConfirm && (
            <Button block loading={props.busy} disabled={!!props.problem} onClick={props.onConfirm}>
              {props.confirmLabel ?? "Confirm in QoreX"}
            </Button>
          )}
          <Button block variant="ghost" disabled={props.busy} onClick={props.onCancel}>
            Cancel
          </Button>
          <p className="q-sheet__note">Testnet only. Qrow never asks for your recovery phrase.</p>
        </div>
      </div>
    </div>
  );
}
