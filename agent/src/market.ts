/**
 * Market News data, server-side only (the API key never reaches the browser).
 * - Prices: CoinMarketCap /v1/cryptocurrency/quotes/latest, one call for all symbols, cached 10 min
 *   (about 4,300 calls a month, under the free plan's 10,000 credits). Attribution: "Data from CoinMarketCap".
 * - QOR: looked up once a day; on 2026-11-12 CMC rejected the symbol, so Qrow shows "not listed".
 * - News: CMC's content endpoint isn't on the free plan (error 1006), so headlines come from
 *   reputable RSS feeds. Only headline, source, date and link: never article text.
 */
const CMC = "https://pro-api.coinmarketcap.com";
const KEY = () => process.env.CMC_API_KEY ?? "";
export const SYMBOLS = ["BTC", "ETH", "USDT", "BNB", "SOL", "XRP", "USDC", "ADA"] as const;
const FEEDS = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss", host: "cointelegraph.com" },
  { source: "Decrypt", url: "https://decrypt.co/feed", host: "decrypt.co" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml", host: "theblock.co" },
];

export interface Price {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
}
export interface Headline {
  title: string;
  link: string;
  source: string;
  published: string; // ISO
}

let priceCache: { at: number; data: Price[]; qorListed: boolean } | undefined;
let qorCheck: { at: number; listed: boolean } | undefined;
let newsCache: { at: number; data: Headline[] } | undefined;

async function cmc<T>(path: string): Promise<T> {
  const r = await fetch(`${CMC}${path}`, { headers: { "X-CMC_PRO_API_KEY": KEY(), Accept: "application/json" } });
  const j = (await r.json()) as T & { status?: { error_code?: number; error_message?: string } };
  if (!r.ok || j.status?.error_code) throw new Error(`cmc ${j.status?.error_code ?? r.status}`);
  return j;
}

export async function prices(): Promise<{ data: Price[]; qorListed: boolean; updated: string }> {
  if (!KEY()) throw new Error("no_key");
  if (!priceCache || Date.now() - priceCache.at > 600_000) {
    const j = await cmc<{ data: Record<string, { name: string; quote: { USD: { price: number; percent_change_24h: number; market_cap: number } } }> }>(
      `/v1/cryptocurrency/quotes/latest?symbol=${SYMBOLS.join(",")}&convert=USD`,
    );
    const data = SYMBOLS.filter((s) => j.data[s]).map((s) => ({
      symbol: s,
      name: j.data[s].name,
      price: j.data[s].quote.USD.price,
      change24h: j.data[s].quote.USD.percent_change_24h,
      marketCap: j.data[s].quote.USD.market_cap,
    }));
    if (!qorCheck || Date.now() - qorCheck.at > 86_400_000) {
      let listed = false;
      try {
        const m = await cmc<{ data: { symbol: string; is_active: number }[] }>("/v1/cryptocurrency/map?symbol=QOR");
        listed = m.data.some((c) => c.is_active === 1);
      } catch {
        listed = false;
      }
      qorCheck = { at: Date.now(), listed };
    }
    priceCache = { at: Date.now(), data, qorListed: qorCheck.listed };
  }
  return { data: priceCache.data, qorListed: priceCache.qorListed, updated: new Date(priceCache.at).toISOString() };
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .trim();

export function parseRss(xml: string, source: string, host: string): Headline[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  const out: Headline[] = [];
  for (const it of items) {
    const title = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const date = Date.parse(decode(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ""));
    let ok = false;
    try {
      const u = new URL(link);
      ok = u.protocol === "https:" && (u.hostname === host || u.hostname.endsWith(`.${host}`));
    } catch {
      ok = false;
    }
    if (!title || !ok || Number.isNaN(date)) continue;
    out.push({ title: title.slice(0, 200), link, source, published: new Date(date).toISOString() });
  }
  return out;
}

export async function news(): Promise<{ data: Headline[]; updated: string }> {
  if (!newsCache || Date.now() - newsCache.at > 900_000) {
    const all = await Promise.all(
      FEEDS.map(async (f) => {
        try {
          const r = await fetch(f.url, { headers: { "User-Agent": "Qrow-testnet-news/0.1 (headlines with links)" } });
          return r.ok ? parseRss(await r.text(), f.source, f.host) : [];
        } catch {
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const data = all
      .flat()
      .filter((h) => (seen.has(h.link) ? false : (seen.add(h.link), true)))
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, 24);
    newsCache = { at: Date.now(), data };
  }
  return { data: newsCache.data, updated: new Date(newsCache.at).toISOString() };
}
