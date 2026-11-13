import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { setUpThisDevice } from "../lib/appKey";
import { preflight, runAction, WindowBlocker, type ActionPlan, type Blocker, type Phase } from "../lib/action";
import { addReceipt, type Receipt } from "../lib/receipts";
import { explainError } from "./PqActionPanel";
import { IconAlert } from "./Icons";
import { ReceiptCard } from "./ReceiptCard";

const PHASE: Record<Phase, string> = {
  device: "Unlocking this device (fingerprint, face or PIN)…",
  qorex: "Approve in QoreX…",
  setup: "Setting up secure contract actions (first time only)…",
  convert: "Converting your tokens for the contract…",
  sending: "Sending and waiting for the block…",
};

export type ReceiptDraft = Omit<Receipt, "hash" | "at" | "steps">;

/** The one blocker, with its one fix (a link, or an action such as adding this device). */
export function BlockerNote({ b, onFix, fixing }: { b: Blocker; onFix?: () => void; fixing?: boolean }) {
  return (
    <div className="notice notice--warn blocker" role="alert">
      <p className="notice__title">
        <IconAlert /> {b.text}
      </p>
      {onFix && b.fix && (
        <button className="btn" type="button" onClick={onFix} disabled={fixing} aria-busy={fixing}>
          {fixing ? "Working…" : b.fix.label}
        </button>
      )}
      {!onFix && b.fix?.to && (
        <Link className="btn" to={b.fix.to}>
          {b.fix.label}
        </Link>
      )}
      {!onFix && b.fix?.href && (
        <a className="btn" href={b.fix.href} target="_blank" rel="noopener noreferrer">
          {b.fix.label}
        </a>
      )}
    </div>
  );
}

/**
 * Every contract action: one confirm screen, one QoreX approval. Checks run silently; if one fails,
 * only that one shows, with one fix. Ends with the receipt and its hash.
 */
export function ActionFlow(props: {
  plan: ActionPlan;
  title: string;
  details: { name: string; value: string }[];
  confirmLabel: string;
  /** Hide the heading when the page above already says what this is (e.g. the Send confirm sheet). */
  hideTitle?: boolean;
  receipt: (txHash: string) => ReceiptDraft;
  onDone?: (txHash: string) => void;
  onCancel: () => void;
}) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [phase, setPhase] = useState<Phase>();
  const [error, setError] = useState<string>();
  const [blocker, setBlocker] = useState<Blocker>();
  const [done, setDone] = useState<Receipt>();
  const [adding, setAdding] = useState<"busy" | "proposed">();

  /** The "other device" fix: propose this device (QoreX approves; the 3-day safety wait still applies). */
  async function addDevice() {
    setAdding("busy");
    setError(undefined);
    try {
      await setUpThisDevice(client, props.plan.user, () => {});
      setAdding("proposed");
      void check.refetch();
    } catch (e) {
      setAdding(undefined);
      setError(explainError(e));
    }
  }
  const check = useQuery({
    queryKey: ["preflight", props.plan.user, props.plan.contract, props.title, props.plan.approve?.amount.toString()],
    queryFn: () => preflight(client, props.plan),
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    enabled: !done && !phase,
  });
  const pre = check.data;
  const shown = blocker ?? pre?.blocker;

  async function go() {
    if (!pre || pre.blocker) return;
    setError(undefined);
    setBlocker(undefined);
    try {
      const r = await runAction(client, props.plan, pre, setPhase);
      const rec: Receipt = { ...props.receipt(r.txHash), hash: r.txHash, at: new Date().toISOString(), steps: r.steps };
      addReceipt(props.plan.user, rec);
      setDone(rec);
      props.onDone?.(r.txHash);
    } catch (e) {
      if (e instanceof WindowBlocker) setBlocker(e.blocker);
      else setError(explainError(e));
      void check.refetch();
    } finally {
      setPhase(undefined);
    }
  }

  if (done) return <ReceiptCard r={done} />;

  return (
    <section className="panel signflow stack" aria-label={props.title}>
      {!props.hideTitle && <h3>{props.title}</h3>}
      {props.details.length > 0 && (
        <dl className="facts">
          {props.details.map((d) => (
            <div key={d.name}>
              <dt>{d.name}</dt>
              <dd className="fig verify__value">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div aria-live="polite" className="stack">

      {adding === "proposed" ? (
        <p className="notice" role="status">
          This device is added. For your safety it can act in 3 days; your other device can cancel it before then.
        </p>
      ) : shown ? (
        <BlockerNote b={shown} onFix={shown.id === "device" ? () => void addDevice() : undefined} fixing={adding === "busy"} />
      ) : (
        pre?.firstTime && !phase && <p className="hint">First time only: this one approval also turns on secure contract actions for this device.</p>
      )}
      {check.isError && !shown && <p className="hint">Couldn’t finish the checks just now: Qrow will retry when you press the button.</p>}
      {phase && (
        <p className="hint" aria-busy="true">
          {PHASE[phase]}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          <IconAlert /> {error}
        </p>
      )}
      </div>

      <div className="row">
        {!shown && (
          <button className="btn" type="button" disabled={!!phase || check.isFetching || (!pre && !check.isError)} onClick={() => (pre ? void go() : void check.refetch())}>
            {phase ? "Working…" : check.isFetching && !pre ? "Checking…" : props.confirmLabel}
          </button>
        )}
        <button className="btn btn--quiet" type="button" disabled={!!phase} onClick={props.onCancel}>
          Back
        </button>
      </div>
    </section>
  );
}
