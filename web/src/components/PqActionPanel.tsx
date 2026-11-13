import { useState, type ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, type Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN, REFUND_TEXT } from "../config/network";
import { unlockForSigning, withSlot } from "../lib/appKey";
import { forget } from "../lib/pq";
import { signPqAction } from "../lib/pqAction";
import { sendViaQorex, XvmError } from "../lib/xvm";
import { IconAlert, IconCheck } from "./Icons";

export interface PqCall {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

type Step = { s: "start" } | { s: "approve" } | { s: "review"; call: PqCall; simulated: string } | { s: "sending" } | { s: "done"; hash: string };

const FRIENDLY: Record<string, string> = {
  BadPqSignature: "The quantum-safe signature didn’t verify. Start again.",
  SignatureExpired: "The quantum-safe signature expired. Sign again.",
  NoPqKey: "Set up this device on the Start page first.",
  NotRecipient: "Only the recipient can claim this payment.",
  NotSender: "Only the sender can do this.",
  NotPending: "This payment is no longer pending.",
  Expired: `The ${REFUND_TEXT} are over. It can only be refunded now.`,
  NotExpired: `The ${REFUND_TEXT} aren’t over yet.`,
  WrongMode: "This payment uses the other release mode.",
  TransferFailed: "The transfer failed.",
};

export function explainError(e: unknown): string {
  if (e instanceof XvmError) return e.message;
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) return FRIENDLY[rev.data.errorName] ?? `The contract refused it (${rev.data.errorName}).`;
    return e.shortMessage;
  }
  if (e instanceof DOMException && e.name === "NotAllowedError") return "You cancelled the passkey prompt. Nothing was signed.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * One post-quantum-protected contract call: this device's key signs the action (passkey prompt),
 * the call is simulated, then QoreX signs and sends it as a MsgCrossVMCall. With `pq` unset (e.g.
 * refundExpired, which anyone may call) there's no device signature.
 */
export function PqActionPanel(props: {
  sender: Address;
  title: string;
  summary: ReactNode;
  contract: Address;
  pq?: { actionName: string; paramsHash: Hex };
  /** An ERC-20 the contract will pull: Qrow asks QoreX for an approval of exactly this amount first. */
  approve?: { token: Address; amount: bigint; label: string };
  build: (auth?: { validUntil: bigint; signature: Hex }) => PqCall;
  describeSimulation: (result: unknown) => string;
  confirmLabel: string;
  onDone: (txHash: string) => void;
  onCancel: () => void;
}) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [step, setStep] = useState<Step>({ s: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  const needsApproval = async () =>
    !!props.approve && (await client.readContract({ address: props.approve.token, abi: erc20Abi, functionName: "allowance", args: [props.sender, props.contract] })) < props.approve.amount;

  const begin = () => run(async () => ((await needsApproval()) ? setStep({ s: "approve" }) : prepare()));

  const approveExact = () =>
    run(async () => {
      await sendViaQorex(client, props.sender, props.approve!.token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [props.contract, props.approve!.amount] }));
      await prepare();
    });

  const prepare = async () => {
    if (props.build({ validUntil: 0n, signature: "0x" }).value) throw new Error("QOR can’t be attached through QoreX’s cross-chain call. Use fUSD for this.");
    let auth: { validUntil: bigint; signature: Hex } | undefined;
    if (props.pq) {
      const { key, slot } = await unlockForSigning(client, props.sender);
      try {
        const s = await signPqAction(client, key, props.contract, props.pq.actionName, props.sender, props.pq.paramsHash);
        auth = { validUntil: s.validUntil, signature: withSlot(slot, s.signature) };
      } finally {
        forget(key);
      }
    }
    const call = props.build(auth);
    const sim = await client.simulateContract({ account: props.sender, address: props.contract, abi: call.abi, functionName: call.functionName, args: call.args });
    setStep({ s: "review", call, simulated: props.describeSimulation(sim.result) });
  };

  const send = (call: PqCall) =>
    run(async () => {
      setStep({ s: "sending" });
      try {
        const r = await sendViaQorex(client, props.sender, props.contract, encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }));
        setStep({ s: "done", hash: r.txHash });
        props.onDone(r.txHash);
      } catch (e) {
        setStep({ s: "review", call, simulated: "" });
        throw e;
      }
    });

  return (
    <section className="panel signflow" aria-live="polite" aria-label={props.title}>
      <h3>{props.title}</h3>
      <div>{props.summary}</div>

      {step.s === "start" && (
        <div className="row">
          <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void begin()}>
            {busy ? "Signing…" : "Continue"}
          </button>
          <button className="btn btn--quiet" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      )}

      {step.s === "approve" && props.approve && (
        <div className="field">
          <p>
            First, allow this contract to take exactly <span className="fig">{props.approve.label}</span> from your wallet, and not a token more.
          </p>
          <div className="row">
            <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void approveExact()}>
              {busy ? "Waiting for QoreX…" : "Approve in QoreX"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={props.onCancel}>
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
            <button className="btn btn--quiet" type="button" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          Confirm in QoreX, then Qrow waits for the block…
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
