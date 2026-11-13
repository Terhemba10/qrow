import type { Address } from "viem";
import { short } from "../lib/address";
import { feeQor, PER_CALL_UQOR } from "../lib/xvm";
import { IconAlert } from "./Icons";

/** Shown when QoreX won't open the EVM window for the site: the user opens it in QoreX themselves. */
export function WindowHelp({ targets, txs, busy, onCheck, onCancel }: { targets: Address[]; txs: number; busy: boolean; onCheck: () => void; onCancel: () => void }) {
  return (
    <div className="notice notice--warn">
      <p className="notice__title">
        <IconAlert /> Open a short EVM window in QoreX
      </p>
      <p>QoreX keeps your EVM side locked. Open it for this action only, then come back:</p>
      <ol>
        <li>In QoreX: Settings, then Security, then EVM access window.</li>
        <li>
          Transactions: <strong className="fig">{txs}</strong>. Duration: about 10 minutes (400 blocks). Spending cap: <span className="fig">{feeQor(Number(PER_CALL_UQOR) * 10 * txs)}</span> QOR.
        </li>
        <li>If QoreX asks for contracts, allow only: {targets.map((t) => short(t)).join(", ")}.</li>
      </ol>
      <div className="row">
        <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={onCheck}>
          {busy ? "Checking…" : "I opened it, check again"}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
