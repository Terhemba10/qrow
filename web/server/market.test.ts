import { describe, expect, it } from "vitest";
import { parseRss } from "./market.js";

const xml = `<rss><channel><title>Feed</title>
<item><title><![CDATA[Bitcoin &amp; friends <b>rally</b>]]></title><link>https://cointelegraph.com/news/a</link><pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate><description>full text that must never be copied</description></item>
<item><title>Phishing</title><link>https://evil.example/cointelegraph.com</link><pubDate>Thu, 12 Nov 2026 11:00:00 GMT</pubDate></item>
<item><title>Plain http</title><link>http://cointelegraph.com/news/b</link><pubDate>Thu, 12 Nov 2026 11:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://cointelegraph.com/news/c</link></item>
</channel></rss>`;

describe("parseRss", () => {
  it("keeps headline, link, source and date only; strips markup; rejects foreign, http and undated items", () => {
    const r = parseRss(xml, "Cointelegraph", "cointelegraph.com");
    expect(r).toEqual([{ title: "Bitcoin & friends rally", link: "https://cointelegraph.com/news/a", source: "Cointelegraph", published: "2026-11-12T10:00:00.000Z" }]);
    expect(JSON.stringify(r)).not.toContain("full text");
  });
});
