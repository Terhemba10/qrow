import { useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { cancelProposal, finishProposal, setUpThisDevice, topUpDevice, type DeviceState, type SetupStep } from "../lib/appKey";
import { WindowManualError } from "../lib/xvm";
import { IconCheck } from "./Icons";
import { explainError } from "./PqActionPanel";
import { WindowHelp } from "./WindowHelp";

const STEP_TEXT: Record<SetupStep, string> = {
  device: "Creating this device’s key (your device asks for your fingerprint, face or PIN)…",
  qorex: "Confirm in QoreX: about 1 test QOR for this device’s fees, and permission to act for you inside windows you open…",
  deviceKey: "Registering this device’s quantum-safe key on chain…",
  window: "Confirm in QoreX: a short EVM window for the registration…",
  register: "Registering this device with Qrow…",
  done: "Done.",
};

/**
 * "Set up this device": a passkey prompt and two QoreX confirmations (fees + permission, then a
 * short window). No codes, nothing to copy or save. Shown inside the readiness card.
 */
export function DeviceSetup({ account, state, onDone }: { account: Address; state?: DeviceState; onDone: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<SetupStep>();
  const [manual, setManual] = useState<WindowManualError>();
  const [result, setResult] = useState<string>();

  const act = (fn: () => Promise<string>) => async () => {
    setBusy(true);
    setError(undefined);
    setManual(undefined);
    try {
      setResult(await fn());
      onDone();
    } catch (e) {
      if (e instanceof WindowManualError) setManual(e);
      else setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  const setUp = act(async () => {
    const r = await setUpThisDevice(client, account, setStep);
    const how = r.mode === "passkey" ? "It unlocks with this device’s fingerprint, face or PIN." : "This browser can’t use a passkey for it, so the browser protects it instead.";
    return r.instant ? `This device is set up. ${how}` : `This device will be added in 3 days, unless you cancel it. ${how}`;
  });

  if (state?.s === "ready") {
    return (
      <div className="stack">
        <p className="hint">This device signs for you after a fingerprint, face or PIN prompt, and only inside EVM windows you open in QoreX.</p>
        <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => void act(async () => (await topUpDevice(account), "Topped up with 1 test QOR."))()}>
          Top up this device’s fees (1 QOR)
        </button>
        {result && <p className="hint">{result}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    );
  }

  if (state?.s === "pending") {
    const due = state.dueAt * 1000;
    return (
      <div className="stack">
        <p>This device is waiting to be added: {due > Date.now() ? `ready on ${new Date(due).toLocaleString()}` : "it can be finished now"}.</p>
        <div className="row">
          {due <= Date.now() && (
            <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void act(async () => (await finishProposal(client, account), "This device is set up."))()}>
              Finish
            </button>
          )}
          <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => void act(async () => (await cancelProposal(client, account), "Cancelled."))()}>
            Cancel it
          </button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="stack">
      <p>
        {state?.s === "otherDevices"
          ? "Your account already uses Qrow on another device. Adding this one takes 3 days, so nobody can add a device quietly. You can cancel it any time."
          : "Qrow keeps a small helper account on this device. It signs your Qrow actions after a fingerprint, face or PIN prompt, and only inside short EVM windows you open in QoreX. You never see or save a key."}
      </p>
      {result ? (
        <p className="notice notice--ok" role="status">
          <IconCheck /> {result}
        </p>
      ) : manual ? (
        <WindowHelp targets={manual.targets} txs={manual.txs} busy={busy} onCheck={() => void setUp()} onCancel={() => setManual(undefined)} />
      ) : (
        <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void setUp()}>
          {busy ? "Setting up…" : "Set up this device"}
        </button>
      )}
      {busy && step && <p className="hint" aria-live="polite">{STEP_TEXT[step]}</p>}
      <p className="hint">Uses about 1.5 test QOR once: 1 QOR moves to the device for its fees, the rest is network fees.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
