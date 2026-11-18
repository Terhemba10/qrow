import { describe, expect, it } from "vitest";
import { qorexDownload } from "./qorex";

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};

describe("qorexDownload", () => {
  it("sends each browser to its own store, never Chrome's for Firefox or Safari", () => {
    expect(qorexDownload(UA.chrome).url).toContain("chromewebstore.google.com");
    expect(qorexDownload(UA.edge).label).toBe("Add QoreX to Edge");
    expect(qorexDownload(UA.firefox).url).toContain("addons.mozilla.org");
    expect(qorexDownload(UA.safari).url).toContain("apps.apple.com");
    expect(qorexDownload(UA.safari).phone).toBe(false);
  });
  it("points phones to the QoreX app", () => {
    expect(qorexDownload(UA.iphone)).toMatchObject({ phone: true });
    expect(qorexDownload(UA.android).url).toContain("play.google.com");
  });
});

import { findQorexNative, findQorexProvider, qorexCanSign, qorexPresent, rememberAnnouncement, type QorexWindow } from "./qorex";

const evm = (flags: Record<string, unknown> = {}) => ({ request: async () => null, ...flags });
const native = (withSign = true) => ({ getKey: async () => ({}), enable: async () => null, ...(withSign ? { signAndBroadcast: async () => ({}) } : { signDirect: async () => ({}) }) });

describe("findQorexProvider (mobile in-app browser shapes)", () => {
  it("finds window.qorex.evm even without the isQoreX flag", () => {
    const p = evm();
    expect(findQorexProvider({ qorex: { evm: p } })).toBe(p);
  });
  it("finds QoreX when it only set window.ethereum", () => {
    const p = evm({ isQoreX: true });
    expect(findQorexProvider({ ethereum: p })).toBe(p);
  });
  it("finds QoreX inside window.ethereum.providers[]", () => {
    const q = evm({ isQoreX: true });
    expect(findQorexProvider({ ethereum: { ...evm({ isMetaMask: true }), providers: [evm({ isMetaMask: true }), q] } })).toBe(q);
  });
  it("never takes another wallet's window.ethereum", () => {
    expect(findQorexProvider({ ethereum: evm({ isMetaMask: true }) })).toBeUndefined();
    expect(qorexPresent({ ethereum: evm({ isMetaMask: true }) })).toBe(false);
  });
  it("is absent with nothing injected (plain mobile browser)", () => {
    expect(qorexPresent({})).toBe(false);
  });
  it("detects late injection: absent, then present once window.qorex appears", () => {
    const w: QorexWindow = {};
    expect(qorexPresent(w)).toBe(false);
    w.qorex = { native: native() };
    expect(qorexPresent(w)).toBe(true);
  });
});

describe("findQorexNative / qorexCanSign", () => {
  it("accepts a native provider without signDirect (an app build with signAndBroadcast only)", () => {
    expect(findQorexNative({ qorex: { native: native(true) } })).toBeTruthy();
    expect(qorexCanSign({ qorex: { native: native(true) } })).toBe(true);
  });
  it("reports present-but-can't-sign for a build with signDirect only", () => {
    expect(qorexPresent({ qorex: { native: native(false) } })).toBe(true);
    expect(qorexCanSign({ qorex: { native: native(false) } })).toBe(false);
  });
});

describe("rememberAnnouncement", () => {
  it("keeps QoreX's EIP-6963 announcement by rdns or name, ignores others", () => {
    expect(rememberAnnouncement({ info: { rdns: "io.metamask" }, provider: evm() })).toBe(false);
    expect(rememberAnnouncement({ info: { rdns: "network.qore.qorex" }, provider: evm() })).toBe(true);
    expect(rememberAnnouncement({ info: { name: "QoreX", rdns: "x" }, provider: evm() })).toBe(true);
  });
});
