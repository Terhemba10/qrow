/**
 * Live QoreX detection, for the extension AND the QoreX app's in-app browser.
 *
 * Where QoreX can be (docs.qorechain.io/qorex/dapp-browser and @qorechain/qorex-types 0.1.0):
 *   - `window.qorex.{native, evm, svm}`: the main object, in the extension and in the app;
 *   - an EIP-6963 announcement with rdns `network.qore.qorex` (name "QoreX");
 *   - `window.ethereum`, but ONLY when no other wallet set it first (in-app browser), possibly as one of
 *     `window.ethereum.providers[]`.
 * Mobile webviews often inject a moment after the page starts, sometimes after the first paint, and may not
 * repeat their EIP-6963 announcement. So Qrow looks in every place, asks for announcements again, listens for
 * `ethereum#initialized` / `qorex#initialized`, re-checks on focus and pageshow, and keeps checking (every
 * 500 ms for 30 s, then every 3 s) until QoreX appears. It never decides "not installed" once.
 */
import { QOREX_DOWNLOAD_URLS, QOREX_NAME, QOREX_RDNS } from "@qorechain/qorex-types";
import type { QorexEip1193Provider, QorexNativeProvider } from "@qorechain/qorex-types";
import { useSyncExternalStore } from "react";

type AnyProvider = { request?: unknown; isQoreX?: boolean; isQorex?: boolean; providers?: unknown[] };
export type QorexWindow = { qorex?: { evm?: unknown; native?: unknown }; ethereum?: AnyProvider };

const win = (): QorexWindow | undefined => (typeof window === "undefined" ? undefined : (window as unknown as QorexWindow));
const isEip1193 = (p: unknown): p is QorexEip1193Provider => !!p && typeof (p as AnyProvider).request === "function";
const saysQorex = (p: unknown) => {
  const a = p as AnyProvider | undefined;
  return !!a && (a.isQoreX === true || a.isQorex === true);
};

/** Providers seen in EIP-6963 announcements (kept: some webviews announce once, before Qrow asks again). */
const announced: QorexEip1193Provider[] = [];
export function rememberAnnouncement(detail: { info?: { rdns?: string; name?: string }; provider?: unknown } | undefined): boolean {
  const isQ = detail?.info?.rdns === QOREX_RDNS || detail?.info?.name === QOREX_NAME;
  if (!isQ || !isEip1193(detail!.provider) || announced.includes(detail!.provider)) return false;
  announced.push(detail!.provider);
  return true;
}
if (typeof window !== "undefined")
  window.addEventListener("eip6963:announceProvider", (e) => {
    if (rememberAnnouncement((e as CustomEvent).detail)) recheck();
  });

/** Ask wallets to announce again (synchronous wallets answer inside this call). */
function requestAnnouncements() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * The QoreX EVM provider, wherever this browser put it. Order: an EIP-6963 announcement, `window.qorex.evm`
 * (even without the `isQoreX` flag: only QoreX writes `window.qorex`), then `window.ethereum` or one of its
 * `providers` flagged as QoreX. Never another wallet's provider.
 */
export function findQorexProvider(w: QorexWindow | undefined = win()): QorexEip1193Provider | undefined {
  if (!w) return undefined;
  if (w === win() && announced[0]) return announced[0];
  const evm = w.qorex?.evm;
  if (isEip1193(evm)) return evm;
  const eth = w.ethereum;
  if (eth) {
    if (saysQorex(eth) && isEip1193(eth)) return eth;
    const inList = Array.isArray(eth.providers) ? eth.providers.find((p) => saysQorex(p) && isEip1193(p)) : undefined;
    if (inList) return inList as QorexEip1193Provider;
  }
  return undefined;
}

/**
 * The QoreX native (QoreChain lane) provider. Looser than qorex-types' `getQorexNative`, which also demands
 * `signDirect`: an app build may only ship what Qrow uses (`enable`/`getKey` and `signAndBroadcast`).
 */
export function findQorexNative(w: QorexWindow | undefined = win()): QorexNativeProvider | undefined {
  const n = w?.qorex?.native as Record<string, unknown> | undefined;
  if (!n || typeof n.getKey !== "function") return undefined;
  if (typeof n.signAndBroadcast !== "function" && typeof n.signDirect !== "function") return undefined;
  return n as unknown as QorexNativeProvider;
}

/** Can QoreX sign and broadcast QoreChain transactions here? Trusts the method, not only the capabilities list. */
export function qorexCanSign(w: QorexWindow | undefined = win()): boolean {
  const n = findQorexNative(w);
  return !!n && typeof n.signAndBroadcast === "function";
}

/** Is QoreX in this page right now (extension or in-app browser)? */
export function qorexPresent(w: QorexWindow | undefined = win()): boolean {
  return !!findQorexNative(w) || !!findQorexProvider(w);
}

let present = typeof window !== "undefined" && qorexPresent();
const listeners = new Set<() => void>();
let started = false;

function recheck() {
  const now = qorexPresent();
  if (now !== present) {
    present = now;
    listeners.forEach((l) => l());
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const again = () => {
    requestAnnouncements();
    recheck();
  };
  window.addEventListener("ethereum#initialized", again);
  window.addEventListener("qorex#initialized", again);
  window.addEventListener("focus", again);
  window.addEventListener("pageshow", again);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && again());
  if (document.readyState !== "complete") window.addEventListener("load", again, { once: true });
  again();
  // Fast for 30 s (extensions and webviews that inject late), then every 3 s until found.
  let n = 0;
  const fast = window.setInterval(() => {
    again();
    if (present || ++n >= 60) {
      window.clearInterval(fast);
      if (!present) {
        const slow = window.setInterval(() => {
          again();
          if (present) window.clearInterval(slow);
        }, 3000);
      }
    }
  }, 500);
}

/** Watch for QoreX: true as soon as it's in the page, in any browser. */
export function watchQorex(onChange: () => void): () => void {
  start();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** React: whether QoreX is installed in this browser, updating live (no reload needed). */
export function useQorexInstalled(): boolean {
  return useSyncExternalStore(watchQorex, () => present, () => false);
}

/** Keep re-checking more often while someone is waiting to install QoreX. */
export function pollQorexWhile(active: () => boolean, ms = 1500) {
  const t = window.setInterval(() => {
    if (!active()) return window.clearInterval(t);
    requestAnnouncements();
    recheck();
  }, ms);
  return () => window.clearInterval(t);
}

/** Phone or tablet browser (where QoreX is the app, not an extension). */
export const isMobileUa = (ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent) => /iPhone|iPad|iPod|Android/i.test(ua);

/**
 * The link "Open in QoreX" follows. QoreX documents a `qorex://` scheme on Android but no dApp-URL format yet
 * (PLAN.md Q4): set VITE_QOREX_DAPP_LINK (e.g. "qorex://browser?url={url}") once QoreChain confirms one.
 */
export function qorexDappLink(url: string): string {
  const tpl = import.meta.env.VITE_QOREX_DAPP_LINK as string | undefined;
  return tpl ? tpl.replace("{url}", encodeURIComponent(url)) : "qorex://";
}

/** Copy the Qrow link (to paste in QoreX's dApp browser), then try to open the QoreX app. */
export async function openInQorex(url: string = location.href): Promise<{ copied: boolean }> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    /* clipboard blocked: the dialog shows the link to copy by hand */
  }
  window.location.href = qorexDappLink(url);
  return { copied };
}

export interface QorexDownload {
  label: string;
  url: string;
  /** On a phone, Qrow runs inside the QoreX app's dApp browser. */
  phone: boolean;
}

/** The right QoreX download for this browser (never the Chrome store for Firefox or Safari users). */
export function qorexDownload(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): QorexDownload {
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  if (iOS) return { label: "Get the QoreX app (App Store)", url: QOREX_DOWNLOAD_URLS.ios, phone: true };
  if (android) return { label: "Get the QoreX app (Google Play)", url: QOREX_DOWNLOAD_URLS.android, phone: true };
  if (/Firefox\//i.test(ua)) return { label: "Add QoreX to Firefox", url: QOREX_DOWNLOAD_URLS.firefox, phone: false };
  const safari = /Safari\//i.test(ua) && !/Chrome\/|Chromium\/|Edg\//i.test(ua);
  if (safari) return { label: "Get QoreX for Safari (Mac App Store)", url: QOREX_DOWNLOAD_URLS.safari, phone: false };
  const name = /Edg\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera" : /Brave/i.test(ua) ? "Brave" : "Chrome";
  return { label: `Add QoreX to ${name}`, url: QOREX_DOWNLOAD_URLS.chrome, phone: false };
}
