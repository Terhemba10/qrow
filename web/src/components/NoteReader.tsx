import { useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { short } from "../lib/address";
import { unlockForSigning } from "../lib/appKey";
import { forget } from "../lib/pq";
import { openNotice, sealKeysFromPqSecret, wipeSealKeys, type PaymentNotice } from "../lib/seal";

const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Decrypt a QoreSeal notice in this tab with this device's key (passkey prompt; memory only). */
export function NoteReader({ me, envelope }: { me: Address; envelope: Hex }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<PaymentNotice>();

  async function read() {
    setBusy(true);
    setError(undefined);
    try {
      const { key } = await unlockForSigning(client, me);
      const keys = sealKeysFromPqSecret(key.secretKey);
      forget(key);
      const n = openNotice(envelope, keys);
      wipeSealKeys(keys);
      if (!n) setError("This note was sealed to a key this device doesn’t hold, or it isn’t a Qrow notice.");
      else setNotice(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t open the note.");
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
  return (
    <div className="note-closed">
      <button className="linkbtn" type="button" disabled={busy} aria-busy={busy} onClick={() => void read()}>
        {busy ? "Decrypting…" : "Read the encrypted notice"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
