import { useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { short } from "../lib/address";
import { forget, unlockPqKey } from "../lib/pq";
import { openNotice, sealKeysFromPqSecret, wipeSealKeys, type PaymentNotice } from "../lib/seal";

const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Decrypt a QoreSeal notice in this tab with the recipient's recovery code (memory only). */
export function NoteReader({ me, envelope }: { me: Address; envelope: Hex }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<PaymentNotice>();

  async function read() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await unlockPqKey(client, me, code);
      setCode("");
      if (!r.ok) {
        setError(r.reason === "format" ? "That isn’t a valid recovery code." : r.reason === "mismatch" ? "That code isn’t this account’s." : "This account has no quantum-safe key.");
        return;
      }
      const keys = sealKeysFromPqSecret(r.key.secretKey);
      forget(r.key);
      const n = openNotice(envelope, keys);
      wipeSealKeys(keys);
      if (!n) setError("This note couldn’t be decrypted with your keys, or it isn’t a Qrow notice.");
      else setNotice(n);
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <div className="note-open" role="status">
        <p className="label">Encrypted notice (QoreSeal, ML-KEM-1024)</p>
        <p>
          You have <span className="fig">{notice.amount} {notice.token}</span> waiting from <span className="mono">{short(notice.from)}</span>. Claim before {fmt.format(new Date(notice.claimBefore))}.
        </p>
        {notice.note && (
          <p>
            Their note: <q className="request-note">{notice.note}</q>
          </p>
        )}
        <p className="hint">Signed by the sender: the escrow checked their ML-DSA-87 signature over this exact note.</p>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="note-closed">
        <button className="linkbtn" type="button" onClick={() => setOpen(true)}>
          Read the encrypted notice
        </button>
      </div>
    );
  }
  return (
    <form
      className="note-closed field"
      onSubmit={(e) => {
        e.preventDefault();
        void read();
      }}
    >
      <label htmlFor={`note-${envelope.slice(2, 10)}`}>Your PQC recovery code</label>
      <input id={`note-${envelope.slice(2, 10)}`} className="input input--mono" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="QRC1-…" />
      <p className="hint">Opens the note in this tab only. The code is cleared right after.</p>
      <div className="row">
        <button className="btn btn--quiet" type="submit" disabled={busy || !code.trim()} aria-busy={busy}>
          {busy ? "Decrypting…" : "Decrypt"}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
