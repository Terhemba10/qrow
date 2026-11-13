import type { UnifiedAccount } from "@qorechain/sdk";
import { useEffect, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { rememberRecipient } from "../agent/recipients";
import { CHAIN, ESCROW, REFUND_SECONDS, REFUND_TEXT } from "../config/network";
import { tokenAddress, type Token } from "../config/tokens";
import { displayAmount, formatUnitsExact } from "../lib/amount";
import { unlockForSigning, withSlot } from "../lib/appKey";
import { wipe } from "../lib/device";
import { clearDraft, type PaymentDraft } from "../lib/draft";
import { signCreate } from "../lib/pq";
import { recipientKemKey, sealNotice } from "../lib/seal";
import { ensureWindow, runAsUser, WindowManualError, XvmError } from "../lib/xvm";
import { IconAlert, IconCheck } from "./Icons";
import { WindowHelp } from "./WindowHelp";

type Step =
  | { s: "start" }
  | { s: "window"; targets: Address[]; txs: number }
  | { s: "review"; args: CreateArgs; simulatedId: bigint }
  | { s: "sending" }
  | { s: "done"; id: bigint; hash: string };

type CreateArgs = readonly [Address, Address, bigint, number, Hex, bigint, Hex];

const ESCROW_ERRORS: Record<string, string> = {
  BadPqSignature: "The quantum-safe signature didn’t verify. Start again.",
  SignatureExpired: "The quantum-safe signature expired. Sign again.",
  NoPqKey: "Set up this device on the Start page first.",
  OverPaymentLimit: "This is above your limit per payment.",
  OverDailyLimit: "This is above your daily limit.",
  InvalidRecipient: "The recipient address isn’t allowed.",
  NonStandardToken: "This token doesn’t transfer exact amounts, so the escrow refuses it.",
  TransferFailed: "The token transfer failed. Check your balance.",
};

export function explainSendError(e: unknown): string {
  if (e instanceof XvmError) return e.message;
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) return ESCROW_ERRORS[rev.data.errorName] ?? `The contract refused it (${rev.data.errorName}).`;
    return e.shortMessage;
  }
  if (e instanceof DOMException && e.name === "NotAllowedError") return "You cancelled the passkey prompt. Nothing was signed.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Confirm and send a payment (approved design, 13 Nov): QoreX opens a short EVM window for exactly
 * these calls; this device's account (passkey) signs the quantum-safe authorisation and runs the
 * calls as you inside that window. Nothing moves without both.
 */
export function SignFlow({ sender, draft, token, onCancel }: { sender: Address; draft: PaymentDraft; token: Token; onCancel: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [step, setStep] = useState<Step>({ s: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const device = useRef<{ acc: UnifiedAccount; slot: number }>();
  const amount = BigInt(draft.amountUnits);
  const tokenAddr = tokenAddress(token);

  const forgetDevice = () => {
    if (device.current) wipe(device.current.acc);
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
      else setError(explainSendError(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => {
    forgetDevice();
    onCancel();
  };

  const prepare = () =>
    run(async () => {
      if (!token.address) throw new Error("Choose fUSD, fETH, fBTC or a launched coin. QOR payments come with the next contract update.");
      const needsApproval = (await client.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "allowance", args: [sender, ESCROW] })) < amount;
      const targets = needsApproval ? [tokenAddr, ESCROW] : [ESCROW];
      // 1. QoreX: a short window for exactly these calls.
      await ensureWindow(sender, targets, targets.length);
      // 2. This device (passkey prompt).
      const u = await unlockForSigning(client, sender);
      device.current = { acc: u.device, slot: u.slot };
      // 3. Exact-amount approval, run as you inside the window.
      if (needsApproval) await runAsUser(client, sender, u.device, [{ to: tokenAddr, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, amount] }) }]);
      // 4. The quantum-safe authorisation, then a simulation of the exact call.
      const mode = draft.freelancer ? 1 : 0;
      let sealedNote: Hex = "0x";
      const kem = await recipientKemKey(draft.recipient).catch(() => undefined);
      if (kem) {
        sealedNote = sealNotice(kem, {
          v: 1,
          amount: formatUnitsExact(amount, token.decimals),
          token: token.symbol,
          from: sender,
          claimBefore: new Date(Date.now() + REFUND_SECONDS * 1000).toISOString(),
          ...(draft.note ? { note: draft.note } : {}),
        });
      }
      const signed = await signCreate(client, u.key, sender, { recipient: draft.recipient, token: tokenAddr, amount, mode, sealedNote });
      const args: CreateArgs = [draft.recipient, tokenAddr, amount, mode, sealedNote, signed.validUntil, withSlot(u.slot, signed.signature)];
      const sim = await client.simulateContract({ account: sender, address: ESCROW, abi: qrowEscrowAbi, functionName: "createPayment", args });
      setStep({ s: "review", args, simulatedId: sim.result });
    });

  const send = (args: CreateArgs) =>
    run(async () => {
      const d = device.current;
      if (!d) throw new Error("Start again: the device was locked.");
      setStep({ s: "sending" });
      try {
        const before = await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" });
        const r = await runAsUser(client, sender, d.acc, [{ to: ESCROW, data: encodeFunctionData({ abi: qrowEscrowAbi, functionName: "createPayment", args }) }]);
        rememberRecipient(sender, draft.recipient);
        clearDraft();
        forgetDevice();
        setStep({ s: "done", id: before + 1n, hash: r.txHash });
      } catch (e) {
        setStep({ s: "review", args, simulatedId: 0n });
        throw e;
      }
    });

  return (
    <section className="panel signflow" aria-labelledby="sign-title" aria-live="polite">
      <h2 id="sign-title">Confirm and send</h2>
      <ol className="steps">
        <li aria-current={step.s === "start" || step.s === "window" ? "step" : undefined}>Open a short EVM window in QoreX</li>
        <li aria-current={step.s === "review" ? "step" : undefined}>This device signs the quantum-safe part (fingerprint, face or PIN)</li>
        <li aria-current={step.s === "sending" || step.s === "done" ? "step" : undefined}>Send</li>
      </ol>

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
        <div className="field">
          {step.simulatedId > 0n && (
            <div className="notice notice--ok">
              <p className="notice__title">
                <IconCheck /> Simulation passed
              </p>
              <p>
                This creates payment <span className="fig">#{step.simulatedId.toString()}</span>: <span className="fig">{displayAmount(amount, token.decimals)} {token.symbol}</span> goes into the escrow at{" "}
                <span className="mono">{ESCROW}</span> for <span className="mono">{draft.recipient}</span>, refundable to you after {REFUND_TEXT}. It carries a quantum-safe ML-DSA-87 signature from this device.
              </p>
            </div>
          )}
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void send(step.args)}>
              Send payment
            </button>
            <button className="btn btn--quiet" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          Sending inside your window, then Qrow waits for the block…
        </p>
      )}

      {step.s === "done" && (
        <div className="notice notice--ok" role="status">
          <p className="notice__title">
            <IconCheck /> Payment #{step.id.toString()} is in escrow
          </p>
          <p>
            The recipient can claim it now. If they don’t within {REFUND_TEXT}, anyone can return it to you. Transaction <span className="mono">{step.hash}</span>.
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
