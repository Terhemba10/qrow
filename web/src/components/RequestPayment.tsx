import QRCode from "qrcode";
import { useEffect, useId, useMemo, useState } from "react";
import type { Address } from "viem";
import { CHAIN } from "../config/network";
import { TOKENS, baseTokenBySymbol as tokenBySymbol, type BaseSymbol as TokenSymbol } from "../config/tokens";
import { parseAmount } from "../lib/amount";
import { buildPayload, NOTE_LIMIT } from "../lib/qrPayload";
import { evmToQor } from "@qorechain/sdk";

/** Request a payment: a versioned qrow:pay payload as a QR code, plus a link that opens Send pre-filled. */
export function RequestPayment({ me }: { me: Address }) {
  const ids = { amount: useId(), note: useId() };
  const [symbol, setSymbol] = useState<TokenSymbol>("fUSD");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [svg, setSvg] = useState<string>();
  const [copied, setCopied] = useState(false);

  const token = tokenBySymbol(symbol)!;
  const parsed = amount.trim() ? parseAmount(amount, token.decimals) : undefined;
  const amountError = parsed && !parsed.ok ? (parsed.reason === "decimals" ? `${symbol} allows at most ${token.decimals} decimal places.` : "Enter a positive amount, for example 25 or 0.5.") : undefined;

  const payload = useMemo(
    () => buildPayload({ to: me, token: symbol, amountUnits: parsed?.ok ? parsed.units : undefined, note: note.trim() || undefined, chainId: CHAIN.id }),
    [me, symbol, parsed, note],
  );
  const link = `${window.location.origin}/send?pay=${encodeURIComponent(payload)}`;

  useEffect(() => {
    let alive = true;
    QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#1F1A18", light: "#FFFFFF" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(undefined));
    return () => {
      alive = false;
    };
  }, [payload]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function downloadPng() {
    const url = await QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2, width: 720, color: { dark: "#1F1A18", light: "#FFFFFF" } });
    const a = document.createElement("a");
    a.href = url;
    a.download = `qrow-request-${symbol}${parsed?.ok ? "-" + amount.trim() : ""}.png`;
    a.click();
  }

  return (
    <section className="panel request" aria-labelledby="req-title">
      <h2 id="req-title">Request a payment</h2>
      <div className="request__grid">
        <div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 var(--space-md)" }}>
            <legend>Token</legend>
            <div className="seg">
              {TOKENS.filter((t) => t.address).map((t) => (
                <span key={t.symbol}>
                  <input type="radio" name="req-token" id={`req-${t.symbol}`} checked={symbol === t.symbol} onChange={() => setSymbol(t.symbol as TokenSymbol)} />
                  <label htmlFor={`req-${t.symbol}`}>{t.symbol}</label>
                </span>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor={ids.amount}>Amount (optional)</label>
            <input id={ids.amount} className="input fig" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Any amount" aria-invalid={!!amountError} />
            {amountError && <p className="field-error">{amountError}</p>}
          </div>
          <div className="field">
            <label htmlFor={ids.note}>Note (optional, visible to anyone with the code)</label>
            <input id={ids.note} className="input" value={note} maxLength={NOTE_LIMIT} onChange={(e) => setNote(e.target.value)} />
            <span className="counter">{note.length}/{NOTE_LIMIT}</span>
          </div>
        </div>
        <figure className="request__qr">
          {svg ? <div className="qr" role="img" aria-label="QR code for this payment request" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="skeleton" style={{ width: 200, height: 200 }} />}
          <figcaption>
            <span className="label">Pays to</span>
            <span className="mono qr__addr">{me}</span>
            <span className="mono qr__addr muted">{evmToQor(me)}</span>
          </figcaption>
        </figure>
      </div>
      <div className="row">
        <button className="btn" type="button" onClick={() => void copy()} disabled={!!amountError}>
          {copied ? "Link copied" : "Copy link"}
        </button>
        <button className="btn btn--quiet" type="button" onClick={() => void downloadPng()} disabled={!!amountError}>
          Download PNG
        </button>
      </div>
      <p className="hint">The payer still sees every check and the full confirm screen. A code never sends anything by itself.</p>
    </section>
  );
}
