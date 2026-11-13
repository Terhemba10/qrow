import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAccount, useConnect, useReconnect } from "wagmi";
import { pollQorexWhile, qorexDownload, useQorexInstalled } from "../lib/qorex";

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
    if (installed && qorex) connect({ connector: qorex });
    else setWanted(true);
  };
  return { connect: go, isPending, installed };
}

/** Mounted once in App: the Get QoreX dialog, the auto-connect, and the silent reconnect. */
export function QorexConnect() {
  const installed = useQorexInstalled();
  const open = useWanted();
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { reconnect } = useReconnect();
  const dialog = useRef<HTMLDialogElement>(null);
  const dl = qorexDownload();

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
          <p>On a phone, Qrow runs inside the QoreX app: install it, then open its dApp Browser (Home, then “Enter a dApp URL”) and go to qrow-app.vercel.app.</p>
          <a className="btn btn--block" href={dl.url} target="_blank" rel="noopener noreferrer">
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
