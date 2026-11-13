import { useState } from "react";
import { EXPLORER_NOTE, EXPLORER_TX, shortHash } from "../lib/tx";

export type TxStatus = "pending" | "confirmed" | "failed";

const LABEL: Record<TxStatus, string> = { pending: "Pending", confirmed: "Confirmed", failed: "Failed" };

/**
 * A transaction hash the way every Qrow tab shows it: status, first/last 6 with Copy, View on explorer,
 * and (once in a block) the block height and time.
 */
export function TxHash({ hash, status, height, time }: { hash: string; status: TxStatus; height?: number; time?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="txhash stack">
      <p className="txhash__line">
        <span className={`status status--${status === "confirmed" ? "settled" : "pending"}`}>{LABEL[status]}</span>{" "}
        <span className="mono" title={hash}>
          {shortHash(hash)}
        </span>
      </p>
      {height !== undefined && (
        <p className="hint fig">
          Block {height.toLocaleString()}
          {time && `, ${new Date(time).toLocaleString()}`}
        </p>
      )}
      <div className="row">
        <button className="btn btn--quiet" type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy hash"}
        </button>
        <a className="btn btn--quiet" href={EXPLORER_TX(hash)} target="_blank" rel="noopener noreferrer">
          View on explorer
        </a>
      </div>
      <p className="hint">{EXPLORER_NOTE}</p>
    </div>
  );
}
