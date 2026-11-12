import { useState, type ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, type Abi, type Address, type Hex } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { CHAIN, REFUND_TEXT } from "../config/network";
import { forget, readWindow, unlockPqKey, type PqKey } from "../lib/pq";
import { signPqAction } from "../lib/pqAction";
import { IconAlert, IconCheck } from "./Icons";

export interface PqCall {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

type Step =
  | { s: "key" }
  | { s: "window"; key?: PqKey; live: boolean }
  | { s: "review"; call: PqCall; simulated: string }
  | { s: "sending"; hash?: Hex }
  | { s: "done"; hash: Hex };

const FRIENDLY: Record<string, string> = {
  BadPqSignature: "The quantum-safe signature didn’t verify. Start again.",
  SignatureExpired: "The quantum-safe signature expired. Sign again.",
  NoPqKey: "This account has no registered quantum-safe key.",
  NotRecipient: "Only the recipient can claim this payment.",
  NotSender: "Only the sender can do this.",
  NotPending: "This payment is no longer pending.",
  Expired: `The ${REFUND_TEXT} are over. It can only be refunded now.`,
  NotExpired: `The ${REFUND_TEXT} aren’t over yet.`,
  WrongMode: "This payment uses the other release mode.",
  TransferFailed: "The transfer failed.",
};

export function explainError(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) {
      return FRIENDLY[rev.data.errorName] ?? `The contract refused it (${rev.data.errorName}).`;
    }
    if (/User rejected|denied/i.test(e.message)) return "You cancelled in your wallet. Nothing was sent.";
    if (/not yet supported/i.test(e.message)) return "This wallet can’t sign EVM transactions yet (QoreX adds this soon). Use an injected wallet that holds this account.";
    if (/window|authori[sz]ation/i.test(e.message)) return "The chain refused it: your EVM window is closed or used up. Open a new one and try again.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * One post-quantum-protected contract call, from key to wallet signature:
 * recovery code (memory only) → EVM window check → ML-DSA-87 signature → simulation → wallet.
 * With `pq` unset (e.g. refundExpired, which anyone may call) the key step is skipped.
 */
export function PqActionPanel(props: {
  sender: Address;
  title: string;
  summary: ReactNode;
  contract: Address;
  pq?: { actionName: string; paramsHash: Hex };
  build: (auth?: { validUntil: bigint; signature: Hex }) => PqCall;
  describeSimulation: (result: unknown) => string;
  confirmLabel: string;
  onDone: (hash: Hex) => void;
  onCancel: () => void;
}) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const { data: wallet } = useWalletClient();
  const [step, setStep] = useState<Step>(props.pq ? { s: "key" } : { s: "window", live: false });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [checkedOnce, setCheckedOnce] = useState(!props.pq);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  const prepare = async (key?: PqKey) => {
    const w = await readWindow(props.sender);
    const targetsOk = w.allowedTargets.length === 0 || w.allowedTargets.includes(props.contract.toLowerCase());
    if (!(w.live && w.remainingTxs >= 1 && targetsOk)) {
      setStep({ s: "window", key, live: w.live });
      setCheckedOnce(true);
      return;
    }
    let auth: { validUntil: bigint; signature: Hex } | undefined;
    if (props.pq) {
      if (!key) throw new Error("The quantum-safe key isn’t loaded.");
      auth = await signPqAction(client, key, props.contract, props.pq.actionName, props.sender, props.pq.paramsHash);
      forget(key);
    }
    const call = props.build(auth);
    const sim = await client.simulateContract({ account: props.sender, address: props.contract, abi: call.abi, functionName: call.functionName, args: call.args, value: call.value });
    setStep({ s: "review", call, simulated: props.describeSimulation(sim.result) });
  };

  const unlock = () =>
    run(async () => {
      const r = await unlockPqKey(client, props.sender, code);
      setCode("");
      if (!r.ok) {
        setError(
          r.reason === "format"
            ? "That isn’t a valid recovery code. It starts with QRC1."
            : r.reason === "mismatch"
              ? "That code makes a different key from the one registered for this account."
              : "This account has no registered quantum-safe key.",
        );
        return;
      }
      await prepare(r.key);
    });

  const send = (call: PqCall) =>
    run(async () => {
      if (!wallet) throw new Error("Connect a wallet that can sign.");
      setStep({ s: "sending" });
      try {
        const hash = await wallet.writeContract({ address: props.contract, abi: call.abi, functionName: call.functionName, args: call.args, value: call.value, chain: CHAIN, account: props.sender });
        setStep({ s: "sending", hash });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The transaction failed on chain.");
        setStep({ s: "done", hash });
        props.onDone(hash);
      } catch (e) {
        setStep({ s: "review", call, simulated: "" });
        throw e;
      }
    });

  const abandon = () => {
    if (step.s === "window") forget(step.key);
    setCode("");
    props.onCancel();
  };

  const cmd = `npm.cmd run window -- open --txs 1 --blocks 120 --targets ${props.contract}`;

  return (
    <section className="panel signflow" aria-live="polite" aria-label={props.title}>
      <h3>{props.title}</h3>
      <div>{props.summary}</div>

      {step.s === "key" && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <label htmlFor="pq-code-action">Your PQC recovery code</label>
          <input id="pq-code-action" className="input input--mono" type="password" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="QRC1-…" />
          <p className="hint">Signs this with your quantum-safe key. Kept in this tab’s memory only and cleared right after.</p>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !code.trim()} aria-busy={busy}>
              {busy ? "Checking the key…" : "Continue"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step.s === "window" && (
        <div className="notice notice--warn">
          <p className="notice__title">
            <IconAlert /> {checkedOnce ? "Open an EVM window first" : "Check your EVM window"}
          </p>
          {checkedOnce && (
            <>
              <p>QoreChain only accepts this inside a window you open with your quantum-safe key. {step.live ? "Your current one is used up or doesn’t cover this contract." : "You have none open."}</p>
              <p className="label">From the Qrow contracts folder:</p>
              <pre className="cmd mono">{cmd}</pre>
            </>
          )}
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void run(() => prepare(step.key))}>
              {busy ? "Checking…" : checkedOnce ? "I’ve opened it, check again" : "Check and continue"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "review" && (
        <>
          {step.simulated && (
            <div className="notice notice--ok">
              <p className="notice__title">
                <IconCheck /> Simulation passed
              </p>
              <p>{step.simulated}</p>
            </div>
          )}
          <div className="row">
            <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void send(step.call)}>
              {props.confirmLabel}
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          {step.hash ? (
            <>
              Sent. Waiting for the block… <span className="mono">{step.hash}</span>
            </>
          ) : (
            "Confirm in your wallet…"
          )}
        </p>
      )}

      {step.s === "done" && (
        <div className="notice notice--ok" role="status">
          <p className="notice__title">
            <IconCheck /> Done
          </p>
          <p>
            Transaction <span className="mono">{step.hash}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">
            <IconAlert /> {error}
          </p>
        </div>
      )}
    </section>
  );
}
