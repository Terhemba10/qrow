import { getAddress } from "viem";
import type { CheckResult } from "../agent/checks";
import { REFUND_DAYS } from "../config/network";
import type { Token } from "../config/tokens";
import { splitForDisplay } from "../lib/address";
import { displayAmount } from "../lib/amount";
import type { PaymentDraft } from "../lib/draft";
import { IconAlert, IconStop } from "./Icons";

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** The address with its first 4 and last 4 characters set large, and every character visible. */
export function BigAddress({ address, label }: { address: string; label: string }) {
  const p = splitForDisplay(address);
  return (
    <p className="bigaddr" aria-label={`${label}: ${address}`}>
      <span aria-hidden="true">
        <span className="bigaddr__fix">{p.prefix}</span>
        <mark className="bigaddr__key">{p.head}</mark>
        <span className="bigaddr__mid">{p.middle}</span>
        <mark className="bigaddr__key">{p.tail}</mark>
      </span>
    </p>
  );
}

export function ConfirmSheet({
  draft,
  token,
  warnings,
}: {
  draft: PaymentDraft;
  token: Token;
  warnings: CheckResult[];
}) {
  const refundBy = new Date(Date.now() + REFUND_DAYS * 86_400_000);
  const danger = warnings.filter((w) => w.level === "danger" || w.level === "block");
  const warn = warnings.filter((w) => w.level === "warn");
  return (
    <section className="confirm" aria-labelledby="confirm-title">
      {danger.map((w) => (
        <div key={w.id} className="notice notice--danger" role="alert">
          <p className="notice__title">
            <IconStop /> {w.title}
          </p>
          {w.detail && <p>{w.detail}</p>}
          {w.lookalike?.map((h) => (
            <div key={h.pastRecipient} className="compare">
              <p className="label">You paid before</p>
              <BigAddress address={getAddress(h.pastRecipient)} label="Address you paid before" />
              <p className="label">This payment</p>
              <BigAddress address={draft.recipient} label="Address in this payment" />
            </div>
          ))}
        </div>
      ))}
      {warn.map((w) => (
        <div key={w.id} className="notice notice--warn">
          <p className="notice__title">
            <IconAlert /> {w.title}
          </p>
          {w.detail && <p>{w.detail}</p>}
        </div>
      ))}

      <div className="panel confirm__sheet">
        <h2 id="confirm-title" className="visually-hidden">
          Payment details
        </h2>
        <p className="label">You send</p>
        <p className="confirm__amount fig">
          {displayAmount(BigInt(draft.amountUnits), token.decimals)} <span className="confirm__unit">{token.symbol}</span>
        </p>
        <p className="label">To</p>
        <BigAddress address={draft.recipient} label="Recipient" />
        <p className="converted mono">{draft.recipientQor}</p>
        <dl className="facts">
          <div>
            <dt>Released</dt>
            <dd>{draft.freelancer ? "When you release it" : "When the recipient claims it"}</dd>
          </div>
          <div>
            <dt>Refundable until</dt>
            <dd>
              {dateFmt.format(refundBy)}
              <span className="hint"> (about {REFUND_DAYS} days; the exact time is set by the block)</span>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
