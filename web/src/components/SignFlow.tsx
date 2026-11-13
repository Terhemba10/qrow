import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { rememberRecipient } from "../agent/recipients";
import { CHAIN, ESCROW, REFUND_SECONDS, REFUND_TEXT } from "../config/network";
import { tokenAddress, type Token } from "../config/tokens";
import { displayAmount, formatUnitsExact } from "../lib/amount";
import { unlockForSigning, withSlot } from "../lib/appKey";
import { clearDraft, type PaymentDraft } from "../lib/draft";
import { forget, signCreate } from "../lib/pq";
import { recipientKemKey, sealNotice } from "../lib/seal";
import { sendViaQorex, XvmError } from "../lib/xvm";
import { IconAlert, IconCheck } from "./Icons";

type Step =
  | { s: "start" }
  | { s: "approve" }
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
 * Confirm and send a payment. Every transaction is signed in QoreX (a MsgCrossVMCall, no MetaMask, no
 * EVM window); the escrow's quantum-safe authorisation is signed by this device's key after a
 * passkey prompt. Nothing moves without the user confirming in QoreX.
 */
export function SignFlow({ sender, draft, token, onCancel }: { sender: Address; draft: PaymentDraft; token: Token; onCancel: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [step, setStep] = useState<Step>({ s: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const amount = BigInt(draft.amountUnits);
  const tokenAddr = tokenAddress(token);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(explainSendError(e));
    } finally {
      setBusy(false);
    }
  }

  const needsApproval = async () => (await client.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "allowance", args: [sender, ESCROW] })) < amount;

  const begin = () =>
    run(async () => {
      if (!token.address) throw new Error("QOR can’t be sent through QoreX’s cross-chain call yet. Choose fUSD, fETH, fBTC or a launched coin.");
      if (await needsApproval()) setStep({ s: "approve" });
      else await prepare();
    });

  // 1. Exact-amount approval, signed in QoreX.
  const approve = () =>
    run(async () => {
      await sendViaQorex(client, sender, tokenAddr, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, amount] }));
      await prepare();
    });

  // 2. This device signs the quantum-safe authorisation (passkey prompt), then we simulate.
  const prepare = async () => {
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
    const { key, slot } = await unlockForSigning(client, sender);
    let signed: { validUntil: bigint; signature: Hex };
    try {
      signed = await signCreate(client, key, sender, { recipient: draft.recipient, token: tokenAddr, amount, mode, sealedNote });
    } finally {
      forget(key);
    }
    const args: CreateArgs = [draft.recipient, tokenAddr, amount, mode, sealedNote, signed.validUntil, withSlot(slot, signed.signature)];
    const sim = await client.simulateContract({ account: sender, address: ESCROW, abi: qrowEscrowAbi, functionName: "createPayment", args });
    setStep({ s: "review", args, simulatedId: sim.result });
  };

  // 3. Confirm in QoreX.
  const send = (args: CreateArgs) =>
    run(async () => {
      setStep({ s: "sending" });
      try {
        const before = await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" });
        const r = await sendViaQorex(client, sender, ESCROW, encodeFunctionData({ abi: qrowEscrowAbi, functionName: "createPayment", args }));
        rememberRecipient(sender, draft.recipient);
        clearDraft();
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
        <li aria-current={step.s === "approve" ? "step" : undefined}>Allow the escrow to take exactly this amount</li>
        <li aria-current={step.s === "start" ? "step" : undefined}>Sign with this device’s quantum-safe key</li>
        <li aria-current={step.s === "review" ? "step" : undefined}>Review the simulation</li>
        <li aria-current={step.s === "sending" || step.s === "done" ? "step" : undefined}>Confirm in QoreX</li>
      </ol>

      {step.s === "start" && (
        <div className="row">
          <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void begin()}>
            {busy ? "Signing…" : "Continue"}
          </button>
          <button className="btn btn--quiet" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      {step.s === "approve" && (
        <div className="field">
          <p>
            First, allow the escrow to take exactly <span className="fig">{displayAmount(amount, token.decimals)} {token.symbol}</span> from your wallet, and not a token more. QoreX asks you to confirm.
          </p>
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void approve()}>
              {busy ? "Waiting for QoreX…" : "Approve in QoreX"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
              Confirm in QoreX and send
            </button>
            <button className="btn btn--quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          Confirm in QoreX, then Qrow waits for the block…
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
