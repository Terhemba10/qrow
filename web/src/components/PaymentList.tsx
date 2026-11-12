import { useState } from "react";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW, REFUND_DAYS } from "../config/network";
import { short } from "../lib/address";
import { displayAmount } from "../lib/amount";
import { actionsFor, type Payment } from "../lib/payments";
import { Countdown, useNow } from "./Countdown";
import { IconAlert } from "./Icons";
import { PqActionPanel } from "./PqActionPanel";

type Act = "claim" | "release" | "cancel" | "refund";

const idParams = (id: bigint) => keccak256(encodeAbiParameters([{ type: "uint256" }], [id]));

const STATUS_WORD: Record<string, string> = {
  Pending: "Waiting",
  Claimed: "Claimed",
  Released: "Released",
  Cancelled: "Cancelled",
  Refunded: "Refunded",
};

/** Incoming or sent payments with their live countdown and the actions open to `me` right now. */
export function PaymentList({
  me,
  payments,
  direction,
  hasPqKey,
  onChanged,
}: {
  me: Address;
  payments: Payment[];
  direction: "in" | "out";
  hasPqKey: boolean | undefined;
  onChanged: () => void;
}) {
  const now = useNow();
  const [open, setOpen] = useState<{ id: bigint; act: Act }>();

  return (
    <ul className="paylist">
      {payments.map((p) => {
        const a = actionsFor(p, me, now);
        const other = direction === "in" ? p.sender : p.recipient;
        const settled = p.status === "Claimed" || p.status === "Released";
        return (
          <li key={p.id.toString()} className="paylist__item">
            <div className="paylist__main">
              <p className="paylist__amount fig">
                {displayAmount(p.amount, p.token.decimals)} {p.token.symbol}
              </p>
              <p className="paylist__who">
                {direction === "in" ? "From" : "To"} <span className="mono" title={other}>{short(other)}</span>
              </p>
              <p className="hint">
                Payment #{p.id.toString()}
                {p.freelancer && ", released by the sender"}
              </p>
            </div>
            <div className="paylist__state">
              <span className={`status status--${p.status.toLowerCase()}${settled ? " status--settled" : ""}`}>{STATUS_WORD[p.status] ?? p.status}</span>
              {p.status === "Pending" && (
                <span className="hint">
                  {now < p.deadline ? (direction === "in" ? "Claim within " : "Refundable in ") : "Refundable now"}
                  {now < p.deadline && <Countdown deadline={p.deadline} now={now} />}
                </span>
              )}
            </div>
            <div className="paylist__actions">
              {a.claim && (
                <button className="btn" type="button" onClick={() => setOpen({ id: p.id, act: "claim" })}>
                  Claim
                </button>
              )}
              {a.release && (
                <button className="btn" type="button" onClick={() => setOpen({ id: p.id, act: "release" })}>
                  Release
                </button>
              )}
              {a.cancel && (
                <button className="btn btn--quiet" type="button" onClick={() => setOpen({ id: p.id, act: "cancel" })}>
                  Cancel payment
                </button>
              )}
              {a.refund && (
                <button className="btn btn--quiet" type="button" onClick={() => setOpen({ id: p.id, act: "refund" })}>
                  Refund to sender
                </button>
              )}
            </div>
            {a.claim && hasPqKey === false && (
              <p className="field-error paylist__note">
                <IconAlert /> You need a registered quantum-safe (ML-DSA-87) key to claim. Set it up in QoreX. If you don’t claim within {REFUND_DAYS} days, it goes back to the sender.
              </p>
            )}
            {open?.id === p.id && (
              <PqActionPanel
                sender={me}
                contract={ESCROW}
                title={
                  open.act === "claim"
                    ? `Claim payment #${p.id}`
                    : open.act === "release"
                      ? `Release payment #${p.id}`
                      : open.act === "cancel"
                        ? `Cancel payment #${p.id}`
                        : `Refund payment #${p.id}`
                }
                summary={
                  <p className="muted">
                    {open.act === "claim" && <>The money moves from the escrow to you. Signed with your quantum-safe key.</>}
                    {open.act === "release" && <>The money moves from the escrow to the recipient. Signed with your quantum-safe key.</>}
                    {open.act === "cancel" && <>The money comes back to you before the recipient claims it. Signed with your quantum-safe key.</>}
                    {open.act === "refund" && <>The 7 days are over, so anyone can return it. It can only go to the sender, so no quantum-safe signature is needed.</>}
                  </p>
                }
                pq={
                  open.act === "refund"
                    ? undefined
                    : {
                        actionName: open.act === "claim" ? "ACTION_CLAIM" : open.act === "release" ? "ACTION_RELEASE" : "ACTION_CANCEL",
                        paramsHash: idParams(p.id),
                      }
                }
                build={(auth) =>
                  open.act === "refund"
                    ? { abi: qrowEscrowAbi, functionName: "refundExpired", args: [p.id] }
                    : { abi: qrowEscrowAbi, functionName: open.act, args: [p.id, auth!.validUntil, auth!.signature] }
                }
                describeSimulation={() =>
                  open.act === "claim"
                    ? `${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol} goes from the escrow to you (${short(me)}).`
                    : open.act === "release"
                      ? `${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol} goes from the escrow to ${short(p.recipient)}.`
                      : `${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol} goes from the escrow back to ${short(p.sender)}.`
                }
                confirmLabel={open.act === "claim" ? "Sign in wallet and claim" : open.act === "release" ? "Sign in wallet and release" : open.act === "cancel" ? "Sign in wallet and cancel" : "Sign in wallet and refund"}
                onDone={() => onChanged()}
                onCancel={() => setOpen(undefined)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
