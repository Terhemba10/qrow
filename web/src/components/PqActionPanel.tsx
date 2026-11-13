import type { UnifiedAccount } from "@qorechain/sdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, type Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN, REFUND_TEXT } from "../config/network";
import { unlockForSigning, withSlot } from "../lib/appKey";
import { wipe } from "../lib/device";
import { signPqAction } from "../lib/pqAction";
import { ensureWindow, runAsUser, WindowManualError, XvmError } from "../lib/xvm";
import { IconAlert, IconCheck } from "./Icons";
import { WindowHelp } from "./WindowHelp";

export interface PqCall {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

type Step =
  | { s: "start" }
  | { s: "window"; targets: Address[]; txs: number }
  | { s: "review"; call: PqCall; simulated: string }
  | { s: "sending" }
  | { s: "done"; hash: string };

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
 * One post-quantum-protected contract call (approved design, 13 Nov): QoreX opens a short window for
 * exactly these calls; this device (passkey) signs the action and runs it as you inside the window.
 * With `pq` unset (e.g. refundExpired, which anyone may call) there's no device signature.
 */
export function PqActionPanel(props: {
  sender: Address;
  title: string;
  summary: ReactNode;
  contract: Address;
  pq?: { actionName: string; paramsHash: Hex };
  /** An ERC-20 the contract will pull: approved for exactly this amount first, inside the same window. */
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
  const device = useRef<UnifiedAccount>();

  const forgetDevice = () => {
    if (device.current) wipe(device.current);
    device.current = undefined;
  };
  useEffect(() => forgetDevice, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (e instanceof WindowManualError) setStep({ s: "window", targets: e.targets, txs: e.txs });
      else setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => {
    forgetDevice();
    props.onCancel();
  };

  const prepare = () =>
    run(async () => {
      if (props.build({ validUntil: 0n, signature: "0x" }).value) throw new Error("QOR can’t be attached yet; use fUSD for this. QOR payments come with the next contract update.");
      const needsApproval =
        !!props.approve && (await client.readContract({ address: props.approve.token, abi: erc20Abi, functionName: "allowance", args: [props.sender, props.contract] })) < props.approve.amount;
      const targets = needsApproval ? [props.approve!.token, props.contract] : [props.contract];
      await ensureWindow(props.sender, targets, targets.length);
      const u = await unlockForSigning(client, props.sender);
      device.current = u.device;
      if (needsApproval) {
        await runAsUser(client, props.sender, u.device, [{ to: props.approve!.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [props.contract, props.approve!.amount] }) }]);
      }
      let auth: { validUntil: bigint; signature: Hex } | undefined;
      if (props.pq) {
        const s = await signPqAction(client, u.key, props.contract, props.pq.actionName, props.sender, props.pq.paramsHash);
        auth = { validUntil: s.validUntil, signature: withSlot(u.slot, s.signature) };
      }
      const call = props.build(auth);
      const sim = await client.simulateContract({ account: props.sender, address: props.contract, abi: call.abi, functionName: call.functionName, args: call.args });
      setStep({ s: "review", call, simulated: props.describeSimulation(sim.result) });
    });

  const send = (call: PqCall) =>
    run(async () => {
      const d = device.current;
      if (!d) throw new Error("Start again: the device was locked.");
      setStep({ s: "sending" });
      try {
        const r = await runAsUser(client, props.sender, d, [{ to: props.contract, data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }) }]);
        forgetDevice();
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
          <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void prepare()}>
            {busy ? "Working…" : "Continue"}
          </button>
          <button className="btn btn--quiet" type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {step.s === "window" && <WindowHelp targets={step.targets} txs={step.txs} busy={busy} onCheck={() => void prepare()} onCancel={cancel} />}

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
            <button className="btn btn--quiet" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          Sending inside your window, then Qrow waits for the block…
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
