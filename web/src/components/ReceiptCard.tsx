import type { Receipt } from "../lib/receipts";
import { IconCheck } from "./Icons";
import { TxHash } from "./TxHash";

/** A receipt: what happened, its hash (pending → confirmed is on Verify), and any set-up steps. */
export function ReceiptCard({ r, compact = false }: { r: Receipt; compact?: boolean }) {
  return (
    <article className={`notice notice--ok receipt${compact ? " receipt--compact" : ""}`} role={compact ? undefined : "status"}>
      <p className="notice__title">
        <IconCheck /> {r.title}
      </p>
      {r.ref && <p className="fig">{r.ref}</p>}
      {r.lines.length > 0 && (
        <dl className="facts">
          {r.lines.map((l) => (
            <div key={l.name}>
              <dt>{l.name}</dt>
              <dd className="fig verify__value">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <TxHash hash={r.hash} status="confirmed" time={compact ? undefined : r.at} />
      {r.steps && r.steps.length > 0 && (
        <details>
          <summary className="hint">Also on chain in this flow ({r.steps.length})</summary>
          <ul className="facts-list">
            {r.steps.map((s) => (
              <li key={s.hash} className="hint">
                {s.label}: <a href={`/verify?q=${s.hash}`}>{`${s.hash.slice(0, 6)}…${s.hash.slice(-6)}`}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
