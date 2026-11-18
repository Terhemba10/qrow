import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { useAccount } from "wagmi";
import { qrowPerpsAbi } from "../abi/QrowPerps";
import { PqActionPanel } from "../components/PqActionPanel";
import { useConnectQorex } from "../components/QorexConnect";
import { PERPS } from "../config/contracts";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { displayAmount, parseAmount } from "../lib/amount";
import { fetchReport, fmtPrice, limitFor, MAX_LEVERAGE, pairId, PAIRS, pnlAt, quotePerp, quoteOf, tpSlProblem, useCandles, usePositions, usePrices, type Pair, type PerpPosition } from "../lib/trade";
import { SwapPage } from "./SwapPage";

const FUSD = tokenBySymbol("fUSD")!;
const fusd = (u: bigint) => displayAmount(u < 0n ? -u : u, FUSD.decimals);
const signed = (u: bigint) => `${u < 0n ? "−" : "+"}${fusd(u)} fUSD`;
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));
const reportArg = (r: Awaited<ReturnType<typeof fetchReport>>) => ({ pair: r.pair, price: r.price, timestamp: r.timestamp, signature: r.signature });
/** A typed trigger price in 1e8 units (empty = none, -1 = not a number). */
const priceE8 = (v: string) => {
  if (!v.trim()) return 0n;
  const p = parseAmount(v, 8);
  return p.ok ? p.units : -1n;
};
const ORDER_TYPES = ["bytes32", "bool", "uint256", "uint256", "uint256", "uint256", "uint256"];
const CLOSED_BY: Record<number, string> = { 2: " (liquidated)", 3: " (take profit)", 4: " (stop loss)" };
const BAD_PRICE = "Enter a price like 1850.5, or leave it empty.";

/** Take profit / stop loss fields: prices in the pair's quote coin, both optional. */
function TpSlFields(props: { pair: Pair; tp: string; sl: string; setTp: (v: string) => void; setSl: (v: string) => void }) {
  return (
    <div className="row">
      <label className="field">
        <span>Take profit ({quoteOf(props.pair)}, optional)</span>
        <input className="input" inputMode="decimal" value={props.tp} placeholder="None" onChange={(e) => props.setTp(e.target.value)} />
      </label>
      <label className="field">
        <span>Stop loss ({quoteOf(props.pair)}, optional)</span>
        <input className="input" inputMode="decimal" value={props.sl} placeholder="None" onChange={(e) => props.setSl(e.target.value)} />
      </label>
    </div>
  );
}

function Chart({ pair, live }: { pair: Pair; live?: bigint }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>();
  const line = useRef<ISeriesApi<"Line">>();
  const ticks = useRef<{ time: UTCTimestamp; value: number }[]>([]);
  const candles = useCandles(pair);
  const hasHistory = (candles.data?.length ?? 0) > 0;

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      height: 320,
      layout: { background: { color: "transparent" }, textColor: "#a3a7c9", fontFamily: "Geist Mono, ui-monospace, monospace" },
      grid: { vertLines: { color: "#22253f" }, horzLines: { color: "#22253f" } },
      rightPriceScale: { borderColor: "#2a2d4a" },
      timeScale: { borderColor: "#2a2d4a", timeVisible: true },
      crosshair: { mode: 0 },
    });
    chart.current = c;
    series.current = c.addCandlestickSeries({ upColor: "#2fe39a", downColor: "#ff7a1a", borderVisible: false, wickUpColor: "#2fe39a", wickDownColor: "#ff7a1a" });
    line.current = c.addLineSeries({ color: "#5fd3f5", lineWidth: 2 });
    return () => c.remove();
  }, []);

  useEffect(() => {
    ticks.current = [];
    line.current?.setData([]);
    series.current?.setData((candles.data ?? []).map((k) => ({ time: k.t as UTCTimestamp, open: k.o, high: k.h, low: k.l, close: k.c })));
    chart.current?.timeScale().fitContent();
  }, [candles.data, pair]);

  // QOR pairs have no history outside the testnet pool: draw the live price as it arrives.
  useEffect(() => {
    if (hasHistory || live === undefined || !line.current) return;
    const t = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const last = ticks.current.at(-1);
    if (last && last.time >= t) return;
    ticks.current.push({ time: t, value: Number(live) / 1e8 });
    line.current.setData(ticks.current);
    chart.current?.timeScale().fitContent();
  }, [live, hasHistory]);

  return (
    <div className="chart">
      <div ref={el} className="chart__canvas" role="img" aria-label={`${pair} price chart`} />
      {!hasHistory && <p className="hint">{pair} has no market history: QOR trades only on the testnet pool, so the chart draws its live price from now on.</p>}
    </div>
  );
}

function OpenForm({ me, pair, price }: { me: Address; pair: Pair; price?: bigint }) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("10");
  const [lev, setLev] = useState(10);
  const [tpIn, setTp] = useState("");
  const [slIn, setSl] = useState("");
  const [signing, setSigning] = useState(false);
  const isLong = side === "long";
  const tp = priceE8(tpIn);
  const sl = priceE8(slIn);
  const m = parseAmount(margin, FUSD.decimals);
  const units = m.ok ? m.units : 0n;
  const q = price && units > 0n ? quotePerp(price, units, lev, isLong) : undefined;
  const limit = price ? limitFor(price, isLong, true) : 0n;
  const tpSlErr = tp < 0n || sl < 0n ? BAD_PRICE : q && price ? tpSlProblem(isLong, price, q.liqPrice, tp, sl) : undefined;
  const ok = !!q && units >= 1_000_000n && units <= 10_000_000_000n && !tpSlErr;
  const order = [pairId(pair), isLong, units, BigInt(lev), limit, tp > 0n ? tp : 0n, sl > 0n ? sl : 0n] as const;

  if (signing && q && price)
    return (
      <PqActionPanel
        sender={me}
        contract={PERPS!}
        title={`${isLong ? "Long" : "Short"} ${pair} ${lev}x`}
        summary={<p className="muted">Filled at a fresh signed price when you approve; refused if it moved more than 1% from {fmtPrice(price, pair)}.</p>}
        approve={{ token: FUSD.address!, amount: units, label: "fUSD" }}
        pq={{ actionName: "ACTION_OPEN", paramsHash: enc(ORDER_TYPES, [...order]) }}
        build={async (auth) => ({
          abi: qrowPerpsAbi,
          functionName: "open",
          args: [
            { pair: order[0], isLong: order[1], margin: order[2], leverage: order[3], acceptablePrice: order[4], takeProfit: order[5], stopLoss: order[6] },
            reportArg(await fetchReport(pair)),
            auth!.validUntil,
            auth!.signature,
          ],
        })}
        confirmLabel={`Open ${side} in QoreX`}
        details={[
          { name: "Margin", value: `${margin} fUSD` },
          { name: "Size", value: `${fusd(q.size)} fUSD (${lev}x)` },
          { name: "Entry (about)", value: fmtPrice(price, pair) },
          { name: "Liquidation price", value: fmtPrice(q.liqPrice, pair) },
          { name: "Fee", value: `${fusd(q.fee)} fUSD (0.05% of size)` },
          { name: "Take profit", value: tp > 0n ? fmtPrice(tp, pair) : "None" },
          { name: "Stop loss", value: sl > 0n ? fmtPrice(sl, pair) : "None" },
        ]}
        receipt={() => ({ kind: "Perp", title: `Opened ${side} ${pair} ${lev}x with ${margin} fUSD`, lines: [] })}
        onDone={() => setSigning(false)}
        onCancel={() => setSigning(false)}
      />
    );

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) setSigning(true);
      }}
    >
      <div className="pmside">
        <button type="button" className={`pmside__yes ${isLong ? "is-on" : ""}`} aria-pressed={isLong} onClick={() => setSide("long")}>
          Long
        </button>
        <button type="button" className={`pmside__no ${!isLong ? "is-on" : ""}`} aria-pressed={!isLong} onClick={() => setSide("short")}>
          Short
        </button>
      </div>
      <label className="field">
        <span>Margin (fUSD, 1 to 10,000)</span>
        <input className="input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Leverage: <strong className="fig">{lev}x</strong>
        </span>
        <input type="range" min={1} max={MAX_LEVERAGE} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-valuetext={`${lev} times`} />
      </label>
      {q && (
        <dl className="facts">
          <div>
            <dt>Size</dt>
            <dd className="fig">{fusd(q.size)} fUSD</dd>
          </div>
          <div>
            <dt>Entry (now)</dt>
            <dd className="fig">{fmtPrice(price, pair)}</dd>
          </div>
          <div>
            <dt>Liquidation</dt>
            <dd className="fig">{fmtPrice(q.liqPrice, pair)}</dd>
          </div>
        </dl>
      )}
      <TpSlFields pair={pair} tp={tpIn} sl={slIn} setTp={setTp} setSl={setSl} />
      {tpSlErr && <p className="field-error">{tpSlErr}</p>}
      {(tp > 0n || sl > 0n) && !tpSlErr && <p className="hint">When the price reaches it, the position closes at that market price, even while you are offline. A fast market can move past a trigger before it runs.</p>}
      {lev >= 50 && <p className="notice notice--warn">At {lev}x a move of about {(100 / lev).toFixed(1)}% against you wipes out the margin.</p>}
      <button className="btn btn--block" type="submit" disabled={!ok || !price}>
        Review {side}
      </button>
    </form>
  );
}

function PositionRow({ me, p, price }: { me: Address; p: PerpPosition; price?: bigint }) {
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState<"form" | "sign">();
  const [tpIn, setTp] = useState(p.takeProfit ? (Number(p.takeProfit) / 1e8).toString() : "");
  const [slIn, setSl] = useState(p.stopLoss ? (Number(p.stopLoss) / 1e8).toString() : "");
  const tp = priceE8(tpIn);
  const sl = priceE8(slIn);
  const liq = quotePerp(p.entryPrice, p.margin, Number(p.size / (p.margin || 1n)), p.isLong).liqPrice;
  const editErr = tp < 0n || sl < 0n ? BAD_PRICE : tpSlProblem(p.isLong, p.entryPrice, liq, tp, sl);
  const live = price ? pnlAt(p.size, p.entryPrice, price, p.isLong) : undefined;
  const limit = price ? limitFor(price, p.isLong, false) : 0n;
  return (
    <li className="perprow">
      <div className="perprow__main">
        <strong>
          {p.isLong ? "Long" : "Short"} {p.pair} {(p.size / (p.margin || 1n)).toString()}x
        </strong>
        <span className="hint fig">
          Margin {fusd(p.margin)} · Entry {fmtPrice(p.entryPrice, p.pair)}
          {p.open ? ` · Now ${fmtPrice(price, p.pair)}` : ` · Exit ${fmtPrice(p.exitPrice, p.pair)}`}
        </span>
        {(p.takeProfit > 0n || p.stopLoss > 0n) && (
          <span className="hint fig">
            TP {p.takeProfit > 0n ? fmtPrice(p.takeProfit, p.pair) : "none"} · SL {p.stopLoss > 0n ? fmtPrice(p.stopLoss, p.pair) : "none"}
          </span>
        )}
      </div>
      <span className={`fig ${(p.open ? (live ?? 0n) : p.pnl) >= 0n ? "pnl--up" : "pnl--down"}`}>{p.open ? (live !== undefined ? signed(live) : "–") : `${signed(p.pnl)}${CLOSED_BY[p.closedBy] ?? ""}`}</span>
      {p.open && !closing && !editing && (
        <div className="row">
          <button className="btn btn--quiet" type="button" onClick={() => setEditing("form")}>
            {p.takeProfit || p.stopLoss ? "Edit TP / SL" : "Set TP / SL"}
          </button>
          <button className="btn btn--quiet" type="button" onClick={() => setClosing(true)} disabled={!price}>
            Close
          </button>
        </div>
      )}
      {p.open && editing === "form" && (
        <form
          className="stack"
          style={{ flexBasis: "100%" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!editErr) setEditing("sign");
          }}
        >
          <TpSlFields pair={p.pair} tp={tpIn} sl={slIn} setTp={setTp} setSl={setSl} />
          <p className="hint">Leave a field empty to remove it. Liquidation price: {fmtPrice(liq, p.pair)}.</p>
          {editErr && <p className="field-error">{editErr}</p>}
          <div className="row">
            <button className="btn" type="submit" disabled={!!editErr}>
              Review
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => setEditing(undefined)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {p.open && editing === "sign" && (
        <PqActionPanel
          sender={me}
          contract={PERPS!}
          title={`TP / SL for #${p.id}`}
          summary={<p className="muted">The position closes by itself when the price reaches your take profit or stop loss.</p>}
          pq={{ actionName: "ACTION_TPSL", paramsHash: enc(["uint256", "uint256", "uint256"], [p.id, tp, sl]) }}
          build={(auth) => ({ abi: qrowPerpsAbi, functionName: "setTpSl", args: [p.id, tp, sl, auth!.validUntil, auth!.signature] })}
          confirmLabel="Save in QoreX"
          details={[
            { name: "Take profit", value: tp > 0n ? fmtPrice(tp, p.pair) : "None" },
            { name: "Stop loss", value: sl > 0n ? fmtPrice(sl, p.pair) : "None" },
          ]}
          receipt={() => ({ kind: "Perp", title: `Set TP / SL on ${p.isLong ? "long" : "short"} ${p.pair}`, lines: [] })}
          onDone={() => setEditing(undefined)}
          onCancel={() => setEditing("form")}
        />
      )}
      {p.open && closing && (
        <PqActionPanel
          sender={me}
          contract={PERPS!}
          title={`Close #${p.id}`}
          summary={<p className="muted">Closed at a fresh signed price, refused if it moved more than 1% against you from {fmtPrice(price, p.pair)}.</p>}
          pq={{ actionName: "ACTION_CLOSE", paramsHash: enc(["uint256", "uint256"], [p.id, limit]) }}
          build={async (auth) => ({ abi: qrowPerpsAbi, functionName: "close", args: [p.id, limit, reportArg(await fetchReport(p.pair)), auth!.validUntil, auth!.signature] })}
          confirmLabel="Close in QoreX"
          details={live !== undefined ? [{ name: "PnL now (before fee)", value: signed(live) }] : []}
          receipt={() => ({ kind: "Perp", title: `Closed ${p.isLong ? "long" : "short"} ${p.pair}`, lines: [] })}
          onDone={() => setClosing(false)}
          onCancel={() => setClosing(false)}
        />
      )}
    </li>
  );
}

export function TradePage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const [pair, setPair] = useState<Pair>("ETH/USDT");
  const [view, setView] = useState<"perp" | "swap">("perp");
  const prices = usePrices();
  const positions = usePositions(me);
  const price = prices.data?.prices[pair];
  const open = (positions.data ?? []).filter((p) => p.open);
  const history = (positions.data ?? []).filter((p) => !p.open);

  return (
    <section className="page" aria-labelledby="trade-title">
      <div className="sheet__head">
        <h1 id="trade-title">Trade</h1>
        <p className="muted">
          Swap test QOR for fUSD, and trade perpetuals with up to {MAX_LEVERAGE}x leverage. ETH, SOL and BNB use live Binance prices; QOR uses the testnet pool. <strong>Testnet only:</strong> no real funds.
        </p>
      </div>

      <div className="seg" role="tablist" aria-label="Trade section">
        {(["perp", "swap"] as const).map((v) => (
          <span key={v}>
            <input type="radio" id={`tv-${v}`} name="trade-view" checked={view === v} onChange={() => setView(v)} />
            <label htmlFor={`tv-${v}`}>{v === "perp" ? "Perpetuals" : "Swap QOR ⇄ fUSD"}</label>
          </span>
        ))}
      </div>

      {view === "swap" ? (
        <SwapPage embedded />
      ) : (
        <>
          <ul className="pairs" aria-label="Pairs">
            {PAIRS.map((p) => (
              <li key={p}>
                <button type="button" className={`pairchip${p === pair ? " is-on" : ""}`} aria-pressed={p === pair} onClick={() => setPair(p)}>
                  <span>{p}</span>
                  <span className="fig hint">{fmtPrice(prices.data?.prices[p], p)}</span>
                </button>
              </li>
            ))}
          </ul>
          {prices.isError && <p className="field-error">Live prices are unavailable right now.</p>}
          <div className="split">
            <section className="panel stack" aria-labelledby="chart-title">
              <div className="section-head">
                <h2 id="chart-title">{pair}</h2>
                <span className="fig">{fmtPrice(price, pair)}</span>
              </div>
              <Chart pair={pair} live={price} />
              <p className="hint">Source: {prices.data?.sources[pair] ?? "…"}</p>
            </section>
            <section className="panel stack" aria-labelledby="perp-title">
              <h2 id="perp-title">Open a position</h2>
              {!PERPS ? (
                <p className="notice notice--warn">The perpetuals contract is being deployed to testnet. Trading opens here as soon as it’s live.</p>
              ) : !me ? (
                <button className="btn" type="button" onClick={connect}>
                  Connect QoreX to trade
                </button>
              ) : (
                <OpenForm me={me} pair={pair} price={price} />
              )}
              <p className="hint">
                Margin is fUSD. <button type="button" className="linkbtn" onClick={() => setView("swap")}>Swap test QOR for fUSD</button> or get it from the <Link to="/faucet">faucet</Link>.
              </p>
            </section>
          </div>
          {me && PERPS && (
            <>
              <section className="stack" aria-labelledby="open-title">
                <h2 id="open-title">Open positions</h2>
                {open.length === 0 ? <p className="muted">No open positions.</p> : <ul className="perplist">{open.map((p) => <PositionRow key={p.id.toString()} me={me} p={p} price={prices.data?.prices[p.pair]} />)}</ul>}
              </section>
              <section className="stack" aria-labelledby="hist-title">
                <h2 id="hist-title">Position history</h2>
                {history.length === 0 ? <p className="muted">Closed positions appear here.</p> : <ul className="perplist">{history.map((p) => <PositionRow key={p.id.toString()} me={me} p={p} />)}</ul>}
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
