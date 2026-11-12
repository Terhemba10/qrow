import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { rememberRecipient } from "../agent/recipients";
import { CHAIN, ESCROW, REFUND_SECONDS, REFUND_TEXT } from "../config/network";
import { tokenAddress, type Token } from "../config/tokens";
import { displayAmount } from "../lib/amount";
import { clearDraft, type PaymentDraft } from "../lib/draft";
import { forget, readWindow, signCreate, unlockPqKey, type PqKey, type WindowStatus } from "../lib/pq";
import { IconAlert, IconCheck } from "./Icons";
import { recipientKemKey, sealNotice } from "../lib/seal";
import { formatUnitsExact } from "../lib/amount";

type Step =
  | { s: "key" }
  | { s: "window"; key: PqKey; status?: WindowStatus }
  | { s: "approve"; key: PqKey }
  | { s: "review"; key: PqKey; args: CreateArgs; simulatedId: bigint }
  | { s: "sending"; hash?: Hex }
  | { s: "done"; id: bigint; hash: Hex }
  | { s: "failed"; message: string };

type CreateArgs = readonly [Address, Address, bigint, number, Hex, bigint, Hex];

const ESCROW_ERRORS: Record<string, string> = {
  BadPqSignature: "The quantum-safe signature didn’t verify. Start again.",
  SignatureExpired: "The quantum-safe signature expired. Sign again.",
  NoPqKey: "Your account has no registered quantum-safe key.",
  OverPaymentLimit: "This is above your limit per payment.",
  OverDailyLimit: "This is above your daily limit.",
  InvalidRecipient: "The recipient address isn’t allowed.",
  NonStandardToken: "This token doesn’t transfer exact amounts, so the escrow refuses it.",
  TransferFailed: "The token transfer failed. Check your balance and approval.",
  BadValue: "The amount of QOR sent doesn’t match the payment.",
};

function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) {
      return ESCROW_ERRORS[rev.data.errorName] ?? `The escrow refused it (${rev.data.errorName}).`;
    }
    if (/User rejected|denied/i.test(e.message)) return "You cancelled the request in your wallet. Nothing was sent.";
    if (/not yet supported/i.test(e.message)) {
      return "This wallet can’t sign EVM transactions yet (QoreX adds this soon). Connect an injected wallet that holds this account.";
    }
    if (/window|authori[sz]ation/i.test(e.message)) return "The chain refused it: your EVM window is closed or used up. Open a new one and try again.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function SignFlow({ sender, draft, token, onCancel }: { sender: Address; draft: PaymentDraft; token: Token; onCancel: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const { data: wallet } = useWalletClient();
  const [step, setStep] = useState<Step>({ s: "key" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const amount = BigInt(draft.amountUnits);
  const tokenAddr = tokenAddress(token);

  const needsApproval = async () =>
    !!token.address &&
    (await client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [sender, ESCROW] })) < amount;

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  const abandon = () => {
    if ("key" in step) forget((step as { key: PqKey }).key);
    setCode("");
    onCancel();
  };

  // 1. Derive the quantum-safe key from the recovery code (memory only).
  const unlock = () =>
    run(async () => {
      const r = await unlockPqKey(client, sender, code);
      setCode("");
      if (!r.ok) {
        setError(
          r.reason === "format"
            ? "That isn’t a valid recovery code. It starts with QRC1."
            : r.reason === "mismatch"
              ? "That code makes a different key from the one registered for this account."
              : "This account has no registered quantum-safe key. Register one first.",
        );
        return;
      }
      await checkWindow(r.key);
    });

  // 2. The chain admits EVM transactions only inside a live, scoped window.
  const checkWindow = async (key: PqKey) => {
    const status = await readWindow(sender);
    const need = (await needsApproval()) ? 2 : 1;
    const targetsOk = status.allowedTargets.length === 0 || (status.allowedTargets.includes(ESCROW.toLowerCase()) && (!token.address || need === 1 || status.allowedTargets.includes(token.address.toLowerCase())));
    if (status.live && status.remainingTxs >= need && targetsOk) {
      if (need === 2) setStep({ s: "approve", key });
      else await prepare(key);
    } else setStep({ s: "window", key, status });
  };

  // 3. Exact-amount approval for an ERC-20.
  const approve = (key: PqKey) =>
    run(async () => {
      if (!wallet) throw new Error("Connect a wallet that can sign.");
      const hash = await wallet.writeContract({ address: token.address!, abi: erc20Abi, functionName: "approve", args: [ESCROW, amount], chain: CHAIN, account: sender });
      await client.waitForTransactionReceipt({ hash });
      await prepare(key);
    });

  // 4. Sign the authorisation with ML-DSA-87 and simulate the exact transaction.
  const prepare = async (key: PqKey) => {
    const mode = draft.freelancer ? 1 : 0;
    // QoreSeal notice for the recipient (only if they registered an ML-KEM-1024 key).
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
    const { validUntil, signature } = await signCreate(client, key, sender, { recipient: draft.recipient, token: tokenAddr, amount, mode, sealedNote });
    forget(key);
    const args: CreateArgs = [draft.recipient, tokenAddr, amount, mode, sealedNote, validUntil, signature];
    const sim = await client.simulateContract({
      account: sender,
      address: ESCROW,
      abi: qrowEscrowAbi,
      functionName: "createPayment",
      args,
      value: token.address ? 0n : amount,
    });
    setStep({ s: "review", key, args, simulatedId: sim.result });
  };

  // 5. You sign the transaction in your wallet.
  const send = (args: CreateArgs) =>
    run(async () => {
      if (!wallet) throw new Error("Connect a wallet that can sign.");
      setStep({ s: "sending" });
      const hash = await wallet.writeContract({
        address: ESCROW,
        abi: qrowEscrowAbi,
        functionName: "createPayment",
        args,
        value: token.address ? 0n : amount,
        chain: CHAIN,
        account: sender,
      });
      setStep({ s: "sending", hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction failed on chain. Nothing left your wallet except the fee.");
      const [ev] = parseEventLogs({ abi: qrowEscrowAbi, logs: receipt.logs, eventName: "PaymentCreated" });
      rememberRecipient(sender, draft.recipient);
      clearDraft();
      setStep({ s: "done", id: ev?.args.id ?? 0n, hash });
    }).then((r) => {
      if (r === undefined) setStep((s) => (s.s === "sending" ? { s: "failed", message: "" } : s));
    });

  const windowCmd = (need: number) =>
    `npm.cmd run window -- open --txs ${need} --blocks 120 --targets ${ESCROW}${token.address && need === 2 ? "," + token.address : ""}`;

  return (
    <section className="panel signflow" aria-labelledby="sign-title" aria-live="polite">
      <h2 id="sign-title">Confirm and send</h2>
      <ol className="steps">
        <li aria-current={step.s === "key" ? "step" : undefined}>Sign with your quantum-safe key</li>
        <li aria-current={step.s === "window" ? "step" : undefined}>Check your EVM window</li>
        {token.address && <li aria-current={step.s === "approve" ? "step" : undefined}>Allow the escrow to take exactly this amount</li>}
        <li aria-current={step.s === "review" ? "step" : undefined}>Review the simulation</li>
        <li aria-current={step.s === "sending" || step.s === "done" ? "step" : undefined}>Sign in your wallet</li>
      </ol>

      {step.s === "key" && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <label htmlFor="pq-code">Your PQC recovery code</label>
          <input id="pq-code" className="input input--mono" type="password" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="QRC1-…" />
          <p className="hint">
            It signs this payment with your quantum-safe key. It stays in this tab’s memory and is cleared as soon as you’ve signed. Qrow never stores or sends it. When QoreX can sign messages, this step moves into your wallet.
          </p>
          <div className="row">
            <button className="btn" type="submit" aria-busy={busy} disabled={busy || code.trim() === ""}>
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
            <IconAlert /> Open an EVM window first
          </p>
          <p>
            QoreChain only accepts an EVM transaction inside a window you open with your quantum-safe key. Open the smallest one: {(step.status?.live ? "your current one is used up or doesn’t cover the escrow" : "you have none open")}.
          </p>
          <p className="label">From the Qrow contracts folder:</p>
          <pre className="cmd mono">{windowCmd(token.address ? 2 : 1)}</pre>
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} onClick={() => void run(() => checkWindow(step.key))}>
              {busy ? "Checking…" : "I’ve opened it, check again"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "approve" && (
        <div className="field">
          <p>
            The escrow needs your permission to take exactly <span className="fig">{displayAmount(amount, token.decimals)} {token.symbol}</span>, and not a token more.
          </p>
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void approve(step.key)}>
              {busy ? "Waiting for your wallet…" : "Approve in wallet"}
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "review" && (
        <div className="field">
          <div className="notice notice--ok">
            <p className="notice__title">
              <IconCheck /> Simulation passed
            </p>
            <p>
              The transaction you’re about to sign creates payment <span className="fig">#{step.simulatedId.toString()}</span>: <span className="fig">{displayAmount(amount, token.decimals)} {token.symbol}</span> leaves your wallet into the escrow at <span className="mono">{ESCROW}</span>, for <span className="mono">{draft.recipient}</span>, refundable to you after {REFUND_TEXT}. It carries a {((step.args[6].length - 2) / 2).toLocaleString()}-byte ML-DSA-87 signature.
            </p>
          </div>
          <div className="row">
            <button className="btn" type="button" aria-busy={busy} disabled={busy} onClick={() => void send(step.args)}>
              Sign in wallet and send
            </button>
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.s === "sending" && (
        <p className="hint" aria-busy="true">
          {step.hash ? (
            <>
              Sent. Waiting for the block… <span className="mono">{step.hash}</span>
            </>
          ) : (
            "Confirm the transaction in your wallet…"
          )}
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
          {step.s === "failed" && (
            <button className="btn btn--quiet" type="button" onClick={abandon}>
              Back to the payment
            </button>
          )}
        </div>
      )}
    </section>
  );
}
