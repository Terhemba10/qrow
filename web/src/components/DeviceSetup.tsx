import { useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { cancelProposal, finishProposal, setUpThisDevice, type DeviceState } from "../lib/appKey";
import { IconCheck } from "./Icons";
import { explainError } from "./PqActionPanel";

/**
 * "Set up this device": one passkey prompt and one QoreX confirmation. No codes to save, nothing to
 * copy. Shown inside the readiness card.
 */
export function DeviceSetup({ account, state, onDone }: { account: Address; state?: DeviceState; onDone: () => void }) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();

  const act = (fn: () => Promise<string>) => async () => {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await fn());
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  const setUp = act(async () => {
    const r = await setUpThisDevice(client, account);
    const how = r.mode === "passkey" ? "It unlocks with this device’s fingerprint, face or PIN." : "This browser can’t use a passkey for it, so it’s protected by the browser instead.";
    return r.instant ? `This device is set up. ${how}` : `This device will be added in 3 days, unless you cancel it. ${how} You get an alert if you use Telegram alerts.`;
  });

  if (state?.s === "pending") {
    const due = state.dueAt * 1000;
    return (
      <div className="stack">
        <p>This device is waiting to be added: {due > Date.now() ? `ready on ${new Date(due).toLocaleString()}` : "it can be finished now"}.</p>
        <div className="row">
          {due <= Date.now() && (
            <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void act(async () => (await finishProposal(client, account), "This device is set up."))()}>
              Finish in QoreX
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
          ? "Your account already uses Qrow on another device. Adding this one takes 3 days, so nobody can add a device quietly. You can cancel it any time and get an alert."
          : "Qrow keeps a quantum-safe key on this device to sign your payments. You never see or save it: your device asks for your fingerprint, face or PIN, and QoreX asks you to confirm once."}
      </p>
      {result ? (
        <p className="notice notice--ok" role="status">
          <IconCheck /> {result}
        </p>
      ) : (
        <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void setUp()}>
          {busy ? "Setting up…" : "Set up this device"}
        </button>
      )}
      <p className="hint">Costs about 0.3 test QOR in network fees, once.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
