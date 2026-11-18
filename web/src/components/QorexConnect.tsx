import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useConnect, useReconnect } from "wagmi";
import { openInQorex, pollQorexWhile, qorexDownload, qorexPresent, useQorexInstalled } from "../lib/qorex";
import { forgetQorexAccount } from "../lib/staking";

/** Whether the "Get QoreX" dialog is open (someone pressed Connect without QoreX installed). */
let wanted = false;
const subs = new Set<() => void>();
const setWanted = (v: boolean) => {
  wanted = v;
  subs.forEach((s) => s());
};
const useWanted = () =>
  useSyncExternalStore(
    (s) => (subs.add(s), () => subs.delete(s)),
    () => wanted,
  );

/**
 * The one way to connect, used by every Connect button: QoreX installed → connect to it directly
 * (no wallet list, no download page); not installed → the Get QoreX dialog, which connects by
 * itself as soon as QoreX appears.
 */
export function useConnectQorex() {
  const installed = useQorexInstalled();
  const { connectors, connect, isPending } = useConnect();
  const go = () => {
    const qorex = connectors.find((c) => c.id === "qorex");
    // Look again right now: a mobile in-app browser may have injected QoreX since the last check.
    if ((installed || qorexPresent()) && qorex) connect({ connector: qorex });
    else setWanted(true);
  };
  return { connect: go, isPending, installed };
}

/** Mounted once in App: the Get QoreX dialog, the auto-connect, and the silent reconnect. */
export function QorexConnect() {
  const installed = useQorexInstalled();
  const open = useWanted();
  const { isConnected, address } = useAccount();
  const { connectors, connect } = useConnect();
  const { reconnect } = useReconnect();

  // Disconnected or switched account: forget the session's remembered QoreX account (see qorexAccount).
  const lastAddr = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastAddr.current && lastAddr.current !== address) forgetQorexAccount();
    lastAddr.current = address;
  }, [address]);
  const dialog = useRef<HTMLDialogElement>(null);
  const dl = qorexDownload();
  const [copied, setCopied] = useState<boolean | null>(null);

  // Returning visitors: QoreX injected after the page loaded, so wagmi's reconnect missed it. Try again.
  useEffect(() => {
    if (!installed || isConnected) return;
    const qorex = connectors.find((c) => c.id === "qorex");
    let last: string | null = null;
    try {
      last = localStorage.getItem("wagmi.recentConnectorId");
    } catch {
      /* storage blocked */
    }
    if (qorex && last && last.includes("qorex")) reconnect({ connectors: [qorex] });
  }, [installed, isConnected, connectors, reconnect]);

  // Someone pressed Connect and then installed QoreX: connect now, no reload.
  useEffect(() => {
    if (!open) return;
    if (installed) {
      setWanted(false);
      const qorex = connectors.find((c) => c.id === "qorex");
      if (qorex && !isConnected) connect({ connector: qorex });
      return;
    }
    return pollQorexWhile(() => wanted);
  }, [open, installed, connectors, connect, isConnected]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="getqorex" aria-labelledby="getqorex-title" onClose={() => setWanted(false)}>
      <h2 id="getqorex-title">Get QoreX to continue</h2>
      {dl.phone ? (
        <>
          <p>On a phone, Qrow runs inside the QoreX app. Open Qrow in QoreX: if the app doesn’t open by itself, open QoreX, tap Home, then “Enter a dApp URL” and paste the link.</p>
          <button
            className="btn btn--block"
            type="button"
            onClick={async () => setCopied((await openInQorex()).copied)}
          >
            Open in QoreX
          </button>
          {copied !== null && (
            <p className="hint" role="status">
              {copied ? "Link copied. Paste it in QoreX’s dApp browser." : <>Copy this link into QoreX: <span className="mono">{location.href}</span></>}
            </p>
          )}
          <a className="btn btn--quiet btn--block" href={dl.url} target="_blank" rel="noopener noreferrer">
            {dl.label}
          </a>
        </>
      ) : (
        <>
          <p>Qrow is approved in the QoreX wallet. Install it and Qrow connects by itself: no reload needed.</p>
          <a className="btn btn--block" href={dl.url} target="_blank" rel="noopener noreferrer">
            {dl.label}
          </a>
        </>
      )}
      <p className="hint" aria-live="polite">
        Watching for QoreX… Already installed? Unlock it, or check it’s turned on for this site.
      </p>
      <form method="dialog" className="row">
        <button className="btn btn--quiet" type="submit">
          Close
        </button>
      </form>
    </dialog>
  );
}
