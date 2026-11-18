import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { setUpThisDevice } from "../lib/appKey";
import { estimateFee, preflight, runAction, WINDOW_GUIDE, WindowBlocker, type ActionPlan, type Blocker, type Phase } from "../lib/action";
import { readWindow } from "../lib/xvm";
import type { Address } from "viem";
import { addReceipt, type Receipt } from "../lib/receipts";
import { explainError } from "./PqActionPanel";
import { IconAlert } from "./Icons";
import { ReceiptCard } from "./ReceiptCard";
import { explainTxError, TxReviewSheet, txToast } from "../ds";

const PHASE: Record<Phase, string> = {
  device: "Confirm it’s you on this device (fingerprint, face or PIN)…",
  qorex: "Approve in QoreX…",
  setup: "Getting this device ready (first time only)…",
  convert: "Preparing your tokens…",
  sending: "Sending. Waiting for the network…",
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
 * Every contract action: ONE review sheet (TxReviewSheet: what you send, the fee and its parts, the contract, the
 * network) and one "Confirm in QoreX". Checks run silently while the sheet is open; a blocker replaces the button
 * with its one fix. Progress and the result go to a status toast that stays on screen across tabs; the receipt
 * is saved to History and shown where the action started.
 */
export function ActionFlow(props: {
  plan: ActionPlan;
  title: string;
  details: { name: string; value: string }[];
  /** Kept for callers; the sheet always says "Confirm in QoreX" (one action name everywhere). */
  confirmLabel: string;
  hideTitle?: boolean;
  /** Context shown inside the sheet under the title. */
  summary?: ReactNode;
  receipt: (txHash: string) => ReceiptDraft;
  onDone?: (txHash: string) => void;
  onCancel: () => void;
}) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [phase, setPhase] = useState<Phase>();
  const [error, setError] = useState<string>();
  const [fixLink, setFixLink] = useState<{ label: string; to?: string }>();
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
  const toastId = `${props.plan.contract}:${props.title}`;

  async function go() {
    if (!pre || pre.blocker) return;
    setError(undefined);
    setFixLink(undefined);
    setBlocker(undefined);
    txToast({ id: toastId, state: "pending", title: props.title, text: "Approve in QoreX, then confirm on this device." });
    try {
      const r = await runAction(client, props.plan, pre, (p) => {
        setPhase(p);
        txToast({ id: toastId, state: "pending", title: props.title, text: PHASE[p] });
      });
      const rec: Receipt = { ...props.receipt(r.txHash), hash: r.txHash, at: new Date().toISOString(), steps: r.steps };
      addReceipt(props.plan.user, rec);
      txToast({ id: toastId, state: "confirmed", title: props.title, text: "Saved to History.", hash: r.txHash });
      setDone(rec);
      props.onDone?.(r.txHash);
    } catch (e) {
      if (e instanceof WindowBlocker) {
        setBlocker(e.blocker);
        txToast({ id: toastId, state: "failed", title: props.title, text: "One more step: open Qrow’s access window in QoreX.", fix: { label: "How to open it", to: "/help#window" } });
      } else {
        const x = explainTxError(e);
        setError(x.text === String((e as Error)?.message ?? e) ? explainError(e) : x.text);
        setFixLink(x.fix);
        txToast({ id: toastId, state: "failed", title: props.title, text: x.text, fix: x.fix });
      }
      void check.refetch();
    } finally {
      setPhase(undefined);
    }
  }

  if (done) return <ReceiptCard r={done} />;

  const fee = pre && !pre.blocker ? estimateFee(pre) : undefined;
  const QOR = { decimals: 6, symbol: "QOR" };
  const a = props.plan.approve;
  /** Blocks the action until fixed (the button is replaced by the fix). */
  const blocking =
    adding === "proposed" ? (
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
    ) : undefined;
  /** Went wrong this time; Confirm stays available to try again. */
  const notice = error ? (
    <p className="field-error" role="alert">
      <IconAlert /> {error} {fixLink?.to && <Link to={fixLink.to}>{fixLink.label}</Link>}
    </p>
  ) : check.isError ? (
    <p className="hint">Couldn’t finish the checks. Press Confirm to try again.</p>
  ) : undefined;

  return (
    <>
      <p className="hint" aria-live="polite">
        {phase ? PHASE[phase] : "Review it in the panel that opened."}
      </p>
      <TxReviewSheet
        open
        review={{
          title: props.title,
          send: a ? [{ units: a.amount, decimals: a.decimals, symbol: a.symbol }] : undefined,
          recipient: { label: "Qrow contract", address: props.plan.contract },
          facts: [
            ...props.details.map((d) => ({ name: d.name, value: d.value })),
            ...(fee && fee.movedUqor > 0n ? [{ name: "Moved to this device", value: "1 QOR for its future fees (first time)" }] : []),
          ],
          fee: fee ? { total: { units: fee.totalUqor, ...QOR }, estimate: true, lines: fee.lines.map((l) => ({ label: l.label, amount: { units: l.uqor, ...QOR } })) } : undefined,
          warning: pre?.firstTime && !phase ? "First time only: this one approval also turns on secure contract actions for this device." : undefined,
        }}
        busy={!!phase || (check.isFetching && !pre)}
        busyText={phase ? PHASE[phase] : "Checking…"}
        problem={blocking}
        hideConfirm={!!blocking && shown?.id !== "device"}
        onConfirm={() => (pre ? void go() : void check.refetch())}
        onCancel={props.onCancel}
      >
        {props.summary}
        {notice}
      </TxReviewSheet>
    </>
  );
}
