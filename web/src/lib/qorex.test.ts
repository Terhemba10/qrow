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
