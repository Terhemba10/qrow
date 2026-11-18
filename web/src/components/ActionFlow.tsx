import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { setUpThisDevice } from "../lib/appKey";
import { preflight, runAction, WINDOW_GUIDE, WindowBlocker, type ActionPlan, type Blocker, type Phase } from "../lib/action";
import { readWindow } from "../lib/xvm";
import type { Address } from "viem";
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

/** ~1.4 s blocks on testnet. */
const hoursLeft = (blocks: number) => (blocks * 1.4) / 3600;

/**
 * QoreX can't open the access window for a website yet, so the user opens it once per visit in QoreX:
 * the exact settings, why it exists, the window's live status, and Continue when it's open.
 */
export function WindowGuide({ user, onReady }: { user: Address; onReady: () => void }) {
  const w = useQuery({ queryKey: ["evm-window", user], queryFn: () => readWindow(user), refetchInterval: 4000, refetchOnWindowFocus: true });
  const open = !!w.data?.live && w.data.remainingTxs > 0;
  return (
    <div className="notice notice--warn blocker stack" role="alert">
      <p className="notice__title">
        <IconAlert /> One more step: open Qrow’s access window in QoreX
      </p>
      <p>QoreX can’t open it from a website yet, so you open it once and every Qrow action works for the next few hours. It’s what stops a stolen key from touching your account.</p>
      <ol className="steps">
        <li>
          In QoreX, go to <strong>Settings → Security → EVM access window</strong>.
        </li>
        <li>
          Set <strong>Duration: {WINDOW_GUIDE.blocks.toLocaleString()} blocks</strong> (the maximum, about {Math.floor(hoursLeft(WINDOW_GUIDE.blocks))} hours), <strong>Transactions: {WINDOW_GUIDE.txs}</strong>, <strong>Spending cap: {WINDOW_GUIDE.capQor} QOR</strong>.
        </li>
        <li>Approve it in QoreX, then come back here.</li>
      </ol>
      <p className="hint" aria-live="polite">
        {w.isPending
          ? "Checking your window…"
          : open
            ? `Window open: ${w.data!.remainingTxs} actions left, about ${hoursLeft(w.data!.remainingBlocks).toFixed(1)} hours.`
            : "No window open yet. Qrow checks every few seconds."}
      </p>
      <p className="hint">Keep the spending cap low: while the window is open, your account’s ordinary key alone can spend QOR up to the cap. Your Qrow NFTs and fUSD still need this device’s quantum-safe signature.</p>
      <div className="row">
        <button className="btn" type="button" disabled={!open} onClick={onReady}>
          {open ? "Continue" : "Waiting for the window…"}
        </button>
        <Link className="btn btn--quiet" to="/help#window">
          Help
        </Link>
      </div>
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
      ) : shown?.id === "window" ? (
        <WindowGuide
          user={props.plan.user}
          onReady={() => {
            setBlocker(undefined);
            void check.refetch();
          }}
        />
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
