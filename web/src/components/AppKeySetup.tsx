import { useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";
import { CHAIN } from "../config/network";
import { newAppKeyCode, registerArgs } from "../lib/appKey";
import { readWindow } from "../lib/pq";
import { IconAlert, IconCheck } from "./Icons";
import { explainError } from "./PqActionPanel";
import { WindowCloser, WindowOpener } from "./WindowOpener";

type Step = { s: "intro" } | { s: "save"; code: string; typed: string; saved: boolean } | { s: "window"; code: string; live: boolean } | { s: "register"; code: string } | { s: "done" };

/**
 * Create and register the Qrow key (one time). The code is shown once; Qrow keeps it only in this
 * component's memory until the registration is sent, then forgets it.
 */
export function AppKeySetup({ account, onDone }: { account: Address; onDone: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const { data: wallet } = useWalletClient();
  const [step, setStep] = useState<Step>({ s: "intro" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const groups = (code: string) => code.split("-");

  async function checkWindowThenRegister(code: string) {
    const w = await readWindow(account);
    const ok = w.live && w.remainingTxs >= 1 && (w.allowedTargets.length === 0 || w.allowedTargets.includes(KEYS.toLowerCase()));
    setStep(ok ? { s: "register", code } : { s: "window", code, live: w.live });
  }

  async function register(code: string) {
    setBusy(true);
    setError(undefined);
    try {
      if (!wallet) throw new Error("Connect your EVM wallet (MetaMask) for this account first.");
      const args = await registerArgs(client, account, code);
      await client.simulateContract({ account, address: KEYS, abi: qrowKeysAbi, functionName: "register", args });
      const hash = await wallet.writeContract({ address: KEYS, abi: qrowKeysAbi, functionName: "register", args, chain: CHAIN, account });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The registration failed on chain. Nothing changed except the fee.");
      setStep({ s: "done" });
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  const download = (code: string) => {
    const blob = new Blob([`Qrow key recovery code (testnet)\nAccount: ${account}\n${code}\n\nKeep this private. Qrow asks for it when you sign. Anyone with it AND your wallet could act as you in Qrow.\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qrow-key-${account.slice(2, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack" aria-live="polite">
      {step.s === "intro" && (
        <>
          <p>
            QoreX keeps your quantum-safe key and doesn’t sign messages for websites yet. So Qrow makes you a second quantum-safe key, just for Qrow, and registers it once on chain. Every payment you make is
            then checked against it.
          </p>
          <button className="btn" type="button" onClick={() => setStep({ s: "save", ...newAppKeyCode(account), typed: "", saved: false })}>
            Create my Qrow key
          </button>
        </>
      )}

      {step.s === "save" && (
        <>
          <p className="notice__title">
            <IconAlert /> Save this recovery code now. Qrow shows it only once.
          </p>
          <p className="keycode mono" aria-label="Your Qrow key recovery code">
            {groups(step.code).map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </p>
          <div className="row">
            <button className="btn btn--quiet" type="button" onClick={() => void navigator.clipboard.writeText(step.code)}>
              Copy
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => download(step.code)}>
              Download as a file
            </button>
          </div>
          <p className="hint">You type it in when you sign in Qrow. It is not your wallet’s 24 words, and Qrow never asks for those. If you lose it, you can reset your Qrow key after a 3-day wait.</p>
          <div className="field">
            <label htmlFor="keycheck">To check you saved it, type its last group of 4 characters</label>
            <input id="keycheck" className="input input--mono" autoComplete="off" spellCheck={false} maxLength={4} value={step.typed} onChange={(e) => setStep({ ...step, typed: e.target.value })} />
          </div>
          <button
            className="btn"
            type="button"
            disabled={step.typed.trim().toUpperCase() !== step.code.slice(-4).toUpperCase() || busy}
            onClick={() => void checkWindowThenRegister(step.code)}
          >
            I saved it, continue
          </button>
        </>
      )}

      {step.s === "window" && (
        <WindowOpener account={account} txs={1} targets={[KEYS]} live={step.live} onOpened={() => void checkWindowThenRegister(step.code)} onCancel={() => setStep({ s: "intro" })} />
      )}

      {step.s === "register" && (
        <>
          <p>Register your Qrow key on chain. Your EVM wallet asks you to confirm one transaction.</p>
          <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void register(step.code)}>
            {busy ? "Waiting for your wallet…" : "Register my Qrow key"}
          </button>
        </>
      )}

      {step.s === "done" && (
        <div className="notice notice--ok" role="status">
          <p className="notice__title">
            <IconCheck /> Your Qrow key is registered
          </p>
          <WindowCloser account={account} />
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
