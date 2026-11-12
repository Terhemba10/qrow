import { closeEvmWindowMsg, evmToQor, openEvmWindowMsg } from "@qorechain/sdk";
import { useState } from "react";
import type { Address } from "viem";
import { qorexAccount, qorexAvailable, signInQorex } from "../lib/staking";
import { IconAlert, IconCheck } from "./Icons";

/**
 * Fee budget per EVM transaction the window may spend, in uqor: 3,000,000 gas at 250 gwei,
 * converted wei to uqor rounding up (same as @qorechain/evm evmWindowCost; = 0.75 QOR).
 * A window can never spend more than this per transaction, so a leaked ECDSA key gains little.
 */
export const PER_TX_UQOR = 750_000n;
/** About 10 minutes at QoreChain's ~5 s blocks: long enough to sign, short enough to be safe. */
export const WINDOW_BLOCKS = 120n;

export function windowCommand(txs: number, targets: string[]) {
  return `npm run window -- open --txs ${txs} --blocks ${WINDOW_BLOCKS} --targets ${targets.join(",")}`;
}

/**
 * Opens the smallest EVM window that does the job, signed in QoreX with the account's hybrid
 * (secp256k1 + ML-DSA-87) key: exact transaction count, ~10 minutes, only the listed contracts.
 * No command line needed. Developers without QoreX can still use the CLI command shown below.
 */
export function WindowOpener(props: { account: Address; txs: number; targets: Address[]; live: boolean; onOpened: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const has = qorexAvailable();
  const targets = props.targets.map((t) => t.toLowerCase());

  async function open() {
    setBusy(true);
    setError(undefined);
    try {
      const me = evmToQor(props.account);
      const inWallet = await qorexAccount();
      if (inWallet !== me) throw new Error(`QoreX is on ${inWallet ?? "no account"}, but this action is for ${me}. Switch accounts in QoreX.`);
      await signInQorex([
        openEvmWindowMsg({ sender: me, blocks: WINDOW_BLOCKS, maxTxs: BigInt(props.txs), maxValue: PER_TX_UQOR * BigInt(props.txs), allowedTargets: targets }),
      ]);
      // The REST view lags a block; give it a moment before the caller re-checks.
      await new Promise((r) => setTimeout(r, 6000));
      props.onOpened();
    } catch (e) {
      setError(e instanceof Error ? (/reject|denied/i.test(e.message) ? "You cancelled in QoreX. Nothing was opened." : e.message) : "QoreX couldn’t open the window.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice notice--warn">
      <p className="notice__title">
        <IconAlert /> Open a short EVM window
      </p>
      <p>
        QoreChain only accepts this inside a window you open with your quantum-safe key, so a stolen classical key alone can do nothing. {props.live ? "Your current window is used up or doesn’t cover this contract." : "You have none open."}
      </p>
      <dl className="facts">
        <div>
          <dt>Transactions</dt>
          <dd className="fig">{props.txs}</dd>
        </div>
        <div>
          <dt>Open for</dt>
          <dd>About 10 minutes ({WINDOW_BLOCKS.toString()} blocks)</dd>
        </div>
        <div>
          <dt>Only to</dt>
          <dd className="mono">{targets.join(", ")}</dd>
        </div>
        <div>
          <dt>Fee budget</dt>
          <dd className="fig">at most {(Number(PER_TX_UQOR * BigInt(props.txs)) / 1e6).toString()} QOR</dd>
        </div>
      </dl>
      <div className="row">
        {has ? (
          <button className="btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void open()}>
            {busy ? "Waiting for QoreX…" : "Open window in QoreX"}
          </button>
        ) : (
          <a className="btn" href="https://build.qorechain.io/start" target="_blank" rel="noopener noreferrer">
            Install QoreX to open windows
          </a>
        )}
        <button className="btn btn--quiet" type="button" disabled={busy} onClick={props.onOpened}>
          I opened one, check again
        </button>
        <button className="btn btn--quiet" type="button" disabled={busy} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <details>
        <summary className="hint">Developers: open it from the command line instead</summary>
        <pre className="cmd mono">{windowCommand(props.txs, targets)}</pre>
      </details>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** After the action: close the window in QoreX so nothing is left open. */
export function WindowCloser({ account }: { account: Address }) {
  const [state, setState] = useState<"idle" | "busy" | "closed" | "error">("idle");
  if (!qorexAvailable()) return null;
  return state === "closed" ? (
    <p className="hint">
      <IconCheck /> Window closed.
    </p>
  ) : (
    <button
      className="btn btn--quiet"
      type="button"
      disabled={state === "busy"}
      aria-busy={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await signInQorex([closeEvmWindowMsg(evmToQor(account))]);
          setState("closed");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "error" ? "Couldn’t close it. Try again" : state === "busy" ? "Closing in QoreX…" : "Close my EVM window now (recommended)"}
    </button>
  );
}
