import { useQuery } from "@tanstack/react-query";
import { IconAlert } from "../components/Icons";

interface Price {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
}
interface Headline {
  title: string;
  link: string;
  source: string;
  published: string;
}

const usd = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 4 }).format(n);
const cap = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;
const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({ ok: false }))) as T & { ok: boolean; reason?: string };
  if (!r.ok || !j.ok) throw new Error(j.reason ?? "unavailable");
  return j;
}

export function NewsPage() {
  const prices = useQuery({
    queryKey: ["market-prices"],
    staleTime: 300_000,
    refetchInterval: 600_000,
    retry: 1,
    queryFn: () => getJson<{ data: Price[]; qorListed: boolean; updated: string }>("/agent/market/prices"),
  });
  const news = useQuery({
    queryKey: ["market-news"],
    staleTime: 600_000,
    retry: 1,
    queryFn: () => getJson<{ data: Headline[]; updated: string }>("/agent/market/news"),
  });

  return (
    <section className="page" aria-labelledby="news-title">
      <div className="sheet__head">
        <h1 id="news-title">Market News</h1>
        <p className="muted">Market prices are real. Qrow balances are testnet tokens with no value.</p>
      </div>

      <section aria-labelledby="px-title" className="stack">
        <div className="section-head">
          <h2 id="px-title">Prices</h2>
          {prices.data && <p className="hint">Updated {when.format(new Date(prices.data.updated))}</p>}
        </div>
        {prices.isPending && <span className="skeleton" style={{ width: "70%", height: 200 }} />}
        {prices.isError && (
          <div className="notice notice--warn" role="alert">
            <p className="notice__title">
              <IconAlert /> Prices aren’t available right now
            </p>
            <p>{prices.error.message === "no_key" ? "The Qrow agent server has no CoinMarketCap key set." : "Start the Qrow agent server, or try again in a minute."}</p>
            <button className="btn" type="button" onClick={() => void prices.refetch()}>
              Try again
            </button>
          </div>
        )}
        {prices.data && (
          <>
            <table className="table">
              <caption className="visually-hidden">Prices in US dollars with 24-hour change</caption>
              <thead>
                <tr>
                  <th scope="col">Coin</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">24 h</th>
                  <th scope="col" className="num">Market cap</th>
                </tr>
              </thead>
              <tbody>
                {prices.data.data.map((p) => (
                  <tr key={p.symbol}>
                    <th scope="row">
                      {p.symbol} <span className="hint">{p.name}</span>
                    </th>
                    <td className="num fig">{usd(p.price)}</td>
                    <td className={`num fig ${p.change24h < 0 ? "down" : "up"}`}>{pct(p.change24h)}</td>
                    <td className="num fig">{cap(p.marketCap)}</td>
                  </tr>
                ))}
                {!prices.data.qorListed && (
                  <tr>
                    <th scope="row">QOR</th>
                    <td className="num muted" colSpan={3}>
                      Not listed on CoinMarketCap. Testnet QOR has no market price.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="hint">
              Data from{" "}
              <a href="https://coinmarketcap.com" target="_blank" rel="noopener noreferrer">
                CoinMarketCap
              </a>
              . Refreshed every 10 minutes.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="hl-title" className="stack">
        <h2 id="hl-title">Headlines</h2>
        {news.isPending && <span className="skeleton" style={{ width: "80%", height: 160 }} />}
        {news.isError && <p className="muted">Headlines need the Qrow agent server running.</p>}
        {news.data && news.data.data.length === 0 && <p className="muted">No headlines right now. The news feeds didn’t respond.</p>}
        {news.data && news.data.data.length > 0 && (
          <ul className="headlines">
            {news.data.data.map((h) => (
              <li key={h.link}>
                <a href={h.link} target="_blank" rel="noopener noreferrer">
                  {h.title}
                </a>
                <p className="hint">
                  {h.source}, {when.format(new Date(h.published))}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Headlines link to Cointelegraph, Decrypt and The Block. Qrow shows titles only. News is not advice.</p>
      </section>
    </section>
  );
}
