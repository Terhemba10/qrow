/**
 * Live QoreX detection. Extensions inject `window.qorex` and announce themselves (EIP-6963) at their
 * own pace, often after the page has loaded, and people install QoreX with Qrow already open. So
 * Qrow never decides "not installed" once: it listens for QoreX's announcement, re-checks for a few
 * seconds after load, and again whenever the tab regains focus. Works the same in every browser
 * (Chrome, Edge, Brave, Opera, Firefox, Safari) and inside the QoreX app's dApp browser.
 */
import { QOREX_DOWNLOAD_URLS, QOREX_RDNS, findQorexEip1193, getQorexNative } from "@qorechain/qorex-types";
import { useSyncExternalStore } from "react";

type QorexWindow = Window & { qorex?: { evm?: { isQoreX?: boolean; request?: unknown } } };

/** Is QoreX in this page right now (extension or in-app browser)? */
export function qorexPresent(): boolean {
  if (typeof window === "undefined") return false;
  if (getQorexNative()) return true;
  const evm = (window as QorexWindow).qorex?.evm;
  if (evm?.isQoreX === true && typeof evm.request === "function") return true;
  return !!findQorexEip1193();
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
  window.addEventListener("eip6963:announceProvider", (e) => {
    const rdns = (e as CustomEvent<{ info?: { rdns?: string } }>).detail?.info?.rdns;
    if (rdns === QOREX_RDNS) recheck();
  });
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && recheck());
  // Extensions can inject a moment after load: look again for 15 seconds, then rely on focus.
  let n = 0;
  const t = window.setInterval(() => {
    recheck();
    if (present || ++n > 30) window.clearInterval(t);
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
  const t = window.setInterval(() => (active() ? recheck() : window.clearInterval(t)), ms);
  return () => window.clearInterval(t);
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
