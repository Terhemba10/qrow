import { useState } from "react";
import { Link } from "react-router-dom";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowPredictAbi } from "../abi/QrowPredict";
import { PqActionPanel } from "../components/PqActionPanel";
import { useConnectQorex } from "../components/QorexConnect";
import { PREDICT } from "../config/contracts";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { displayAmount, parseAmount } from "../lib/amount";
import { Outcome, pct, quoteBuy, quoteSell, SEED_MARKETS, useMarkets, usePositions, withSlippage, type MarketRow, type Position } from "../lib/predict";
import { qorexAccount } from "../lib/staking";
import { evmToQor } from "@qorechain/sdk";

const FUSD = tokenBySymbol("fUSD")!;
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));
const fusd = (u: bigint) => displayAmount(u, FUSD.decimals);
const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const OUT: Record<Outcome, string> = { [Outcome.None]: "", [Outcome.Yes]: "YES", [Outcome.No]: "NO", [Outcome.Invalid]: "Invalid (refunds)" };

const AUTH_KEY = (a: string) => `qrow.predict.auth.${a.toLowerCase()}`;
const readAuth = (a?: string) => {
  try {
    return !!a && localStorage.getItem(AUTH_KEY(a)) === "1";
  } catch {
    return false;
  }
};

/** The authorise step: QoreX confirms which account is trading (its approval prompt), matched to the connected one. */
function Authorise({ me, onDone }: { me: Address; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <div className="panel stack">
      <h2>Authorise Predictions</h2>
      <p className="muted">
        QoreX asks you to confirm the account that will trade. Nothing is sent and nothing is spent. Each trade is approved in QoreX later, with your quantum-safe key.
      </p>
      {err && <p className="field-error">{err}</p>}
      <button
        className="btn"
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setErr(undefined);
          try {
            const qor = await qorexAccount();
            if (qor !== evmToQor(me)) throw new Error("QoreX is on a different account from the one Qrow shows. Choose the same account in QoreX.");
            try {
              localStorage.setItem(AUTH_KEY(me), "1");
            } catch {
              /* private mode: ask again next visit */
            }
            onDone();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Approve in QoreX…" : "Authorise in QoreX"}
      </button>
    </div>
  );
}

function ProbBar({ p }: { p: number }) {
  return (
    <div className="probbar" role="img" aria-label={`YES ${pct(p)}, NO ${pct(1 - p)}`}>
      <span className="probbar__yes" style={{ width: `${Math.max(2, p * 100)}%` }}>
        YES {pct(p)}
      </span>
      <span className="probbar__no">NO {pct(1 - p)}</span>
    </div>
  );
}

function MarketCard({ m, pos, onOpen }: { m: MarketRow; pos?: Position; onOpen: () => void }) {
  const ended = Date.now() / 1000 >= m.endTime;
  return (
    <li className="pmcard">
      <button type="button" className="pmcard__btn" onClick={onOpen}>
        <span className="badge">{m.category}</span>
        <span className="pmcard__q">{m.question}</span>
        <ProbBar p={m.yesProb} />
        <span className="hint fig">
          Vol {fusd(m.volume)} fUSD · {m.resolved ? `Resolved: ${OUT[m.outcome]}` : ended ? "Ended, awaiting result" : `Ends ${day(m.endTime)}`}
        </span>
        {pos && (pos.yes > 0n || pos.no > 0n) && (
          <span className="hint fig">
            You: {pos.yes > 0n ? `${fusd(pos.yes)} YES` : ""} {pos.no > 0n ? `${fusd(pos.no)} NO` : ""}
          </span>
        )}
      </button>
    </li>
  );
}

function Trade({ me, m, pos, onDone }: { me: Address; m: MarketRow; pos?: Position; onDone: () => void }) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("5");
  const [signing, setSigning] = useState(false);
  const yes = side === "yes";
  const parsed = parseAmount(amount, FUSD.decimals);
  const units = parsed.ok ? parsed.units : 0n;
  const held = pos ? (yes ? pos.yes : pos.no) : 0n;
  const quote = units > 0n ? (mode === "buy" ? quoteBuy(m.yesPool, m.noPool, yes, units) : units <= held ? quoteSell(m.yesPool, m.noPool, yes, units) : 0n) : 0n;
  const min = withSlippage(quote);
  const ended = Date.now() / 1000 >= m.endTime;
  const claimable = m.resolved && Date.now() / 1000 >= m.resolvedAt + 3600;

  if (m.resolved) {
    return (
      <div className="panel stack">
        <p>
          Result: <strong>{OUT[m.outcome]}</strong>. {claimable ? "Claims are open." : `Claims open ${new Date((m.resolvedAt + 3600) * 1000).toLocaleTimeString()} (1-hour dispute delay).`}
        </p>
        {pos && pos.payout > 0n && claimable && !signing && (
          <button className="btn" type="button" onClick={() => setSigning(true)}>
            Claim {fusd(pos.payout)} fUSD
          </button>
        )}
        {pos?.claimed && <p className="notice notice--ok">You claimed your winnings.</p>}
        {signing && pos && (
          <PqActionPanel
            sender={me}
            contract={PREDICT!}
            title={`Claim ${fusd(pos.payout)} fUSD`}
            summary={<p className="muted">Your shares in this market are redeemed: 1 fUSD per winning share.</p>}
            pq={{ actionName: "ACTION_CLAIM", paramsHash: enc(["uint256"], [m.id]) }}
            build={(auth) => ({ abi: qrowPredictAbi, functionName: "claim", args: [m.id, auth!.validUntil, auth!.signature] })}
            confirmLabel="Claim in QoreX"
            details={[{ name: "Payout", value: `${fusd(pos.payout)} fUSD` }]}
            receipt={() => ({ kind: "Prediction claim", title: `Claimed ${fusd(pos.payout)} fUSD`, lines: [{ name: "Market", value: m.question }] })}
            onDone={() => {
              setSigning(false);
              onDone();
            }}
            onCancel={() => setSigning(false)}
          />
        )}
      </div>
    );
  }
  if (ended) return <p className="notice">Trading has ended. The result is set by the Qrow admin after the end date, then a 1-hour dispute delay.</p>;

  return (
    <div className="panel stack">
      {!signing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (quote > 0n) setSigning(true);
          }}
        >
          <div className="seg" role="radiogroup" aria-label="Buy or sell">
            {(["buy", "sell"] as const).map((k) => (
              <span key={k}>
                <input type="radio" id={`pm-${k}`} name="pm-mode" checked={mode === k} onChange={() => setMode(k)} />
                <label htmlFor={`pm-${k}`}>{k === "buy" ? "Buy" : "Sell"}</label>
              </span>
            ))}
          </div>
          <div className="pmside">
            <button type="button" className={`pmside__yes ${yes ? "is-on" : ""}`} aria-pressed={yes} onClick={() => setSide("yes")}>
              YES {pct(m.yesProb)}
            </button>
            <button type="button" className={`pmside__no ${!yes ? "is-on" : ""}`} aria-pressed={!yes} onClick={() => setSide("no")}>
              NO {pct(1 - m.yesProb)}
            </button>
          </div>
          <label className="field">
            <span>{mode === "buy" ? "Spend (fUSD)" : `Shares to sell (you have ${fusd(held)})`}</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <p className="hint fig" aria-live="polite">
            {quote > 0n
              ? mode === "buy"
                ? `≈ ${fusd(quote)} ${side.toUpperCase()} shares. Pays ${fusd(quote)} fUSD if ${side.toUpperCase()} wins.`
                : `≈ ${fusd(quote)} fUSD back.`
              : mode === "sell" && units > held
                ? "You don’t hold that many shares."
                : "Enter an amount."}
          </p>
          <button className="btn btn--block" type="submit" disabled={quote === 0n}>
            Review {mode === "buy" ? `buy ${side.toUpperCase()}` : `sell ${side.toUpperCase()}`}
          </button>
          <p className="hint">
            Need fUSD? <Link to="/swap">Swap test QOR for fUSD</Link> (one QoreX approval) or get it from the <Link to="/faucet">faucet</Link>.
          </p>
        </form>
      ) : mode === "buy" ? (
        <PqActionPanel
          sender={me}
          contract={PREDICT!}
          title={`Buy ${side.toUpperCase()}`}
          summary={<p className="muted">{m.question}</p>}
          approve={{ token: FUSD.address!, amount: units, label: "fUSD" }}
          pq={{ actionName: "ACTION_BUY", paramsHash: enc(["uint256", "bool", "uint256", "uint256"], [m.id, yes, units, min]) }}
          build={(auth) => ({ abi: qrowPredictAbi, functionName: "buy", args: [m.id, yes, units, min, auth!.validUntil, auth!.signature] })}
          confirmLabel="Buy in QoreX"
          details={[
            { name: "Spend", value: `${amount} fUSD` },
            { name: "Shares (at least)", value: `${fusd(min)} ${side.toUpperCase()}` },
            { name: "Fee", value: "1% (to the market’s liquidity)" },
          ]}
          receipt={() => ({ kind: "Prediction", title: `Bought ${fusd(quote)} ${side.toUpperCase()} for ${amount} fUSD`, lines: [{ name: "Market", value: m.question }] })}
          onDone={() => {
            setSigning(false);
            onDone();
          }}
          onCancel={() => setSigning(false)}
        />
      ) : (
        <PqActionPanel
          sender={me}
          contract={PREDICT!}
          title={`Sell ${side.toUpperCase()}`}
          summary={<p className="muted">{m.question}</p>}
          pq={{ actionName: "ACTION_SELL", paramsHash: enc(["uint256", "bool", "uint256", "uint256"], [m.id, yes, units, min]) }}
          build={(auth) => ({ abi: qrowPredictAbi, functionName: "sell", args: [m.id, yes, units, min, auth!.validUntil, auth!.signature] })}
          confirmLabel="Sell in QoreX"
          details={[
            { name: "Shares", value: `${amount} ${side.toUpperCase()}` },
            { name: "You get (at least)", value: `${fusd(min)} fUSD` },
          ]}
          receipt={() => ({ kind: "Prediction", title: `Sold ${amount} ${side.toUpperCase()} for ${fusd(quote)} fUSD`, lines: [{ name: "Market", value: m.question }] })}
          onDone={() => {
            setSigning(false);
            onDone();
          }}
          onCancel={() => setSigning(false)}
        />
      )}
    </div>
  );
}

export function PredictPage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const client = usePublicClient({ chainId: CHAIN.id });
  const markets = useMarkets();
  const rows = markets.data ?? [];
  const positions = usePositions(me, rows.map((r) => r.id));
  const [authed, setAuthed] = useState(() => readAuth(me));
  const [open, setOpen] = useState<bigint>();
  const [filter, setFilter] = useState<string>("All");
  const ok = authed || readAuth(me);
  const cats = ["All", ...new Set(rows.map((r) => r.category))];
  const shown = rows.filter((r) => filter === "All" || r.category === filter);
  const current = rows.find((r) => r.id === open);

  return (
    <section className="page" aria-labelledby="pm-title">
      <div className="sheet__head">
        <h1 id="pm-title">Prediction Markets</h1>
        <p className="muted">
          Predict YES or NO by buying shares. Prices move with every trade and show the market’s probability. A winning share pays 1 fUSD. <strong>Testnet only:</strong> fUSD has no value.
        </p>
      </div>

      {!PREDICT && (
        <div className="notice notice--warn">
          <p className="notice__title">The prediction contract is being deployed to testnet.</p>
          <p>These are the first markets. Trading opens here as soon as it’s live.</p>
          <ul className="pmlist">
            {SEED_MARKETS.map((s) => (
              <li key={s.question} className="pmcard">
                <div className="pmcard__btn">
                  <span className="badge">{s.category}</span>
                  <span className="pmcard__q">{s.question}</span>
                  <ProbBar p={0.5} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {PREDICT && !me && (
        <div className="panel stack">
          <p>Connect QoreX to trade. You can browse the markets below without connecting.</p>
          <button className="btn" type="button" onClick={connect}>
            Connect QoreX
          </button>
        </div>
      )}
      {PREDICT && me && !ok && <Authorise me={me} onDone={() => setAuthed(true)} />}

      {PREDICT && (
        <>
          {markets.isPending && <span className="skeleton" style={{ width: "100%", height: 160 }} />}
          {markets.isError && <p className="field-error">Couldn’t load the markets from the testnet.</p>}
          {rows.length > 0 && (
            <div className="seg" role="radiogroup" aria-label="Category">
              {cats.map((c) => (
                <span key={c}>
                  <input type="radio" id={`pmc-${c}`} name="pm-cat" checked={filter === c} onChange={() => setFilter(c)} />
                  <label htmlFor={`pmc-${c}`}>{c}</label>
                </span>
              ))}
            </div>
          )}
          <div className={current ? "split" : ""}>
            <ul className="pmlist">
              {shown.map((m) => (
                <MarketCard key={m.id.toString()} m={m} pos={positions.data?.get(m.id.toString())} onOpen={() => setOpen(m.id)} />
              ))}
            </ul>
            {current && (
              <section className="stack" aria-labelledby="pm-open">
                <div className="section-head">
                  <h2 id="pm-open">{current.question}</h2>
                  <button className="btn btn--quiet" type="button" onClick={() => setOpen(undefined)}>
                    Close
                  </button>
                </div>
                <ProbBar p={current.yesProb} />
                <dl className="facts">
                  <div>
                    <dt>Volume</dt>
                    <dd className="fig">{fusd(current.volume)} fUSD</dd>
                  </div>
                  <div>
                    <dt>Ends</dt>
                    <dd>{day(current.endTime)}</dd>
                  </div>
                  <div>
                    <dt>Your position</dt>
                    <dd className="fig">
                      {(() => {
                        const p = positions.data?.get(current.id.toString());
                        return p && (p.yes > 0n || p.no > 0n) ? `${fusd(p.yes)} YES, ${fusd(p.no)} NO` : "None";
                      })()}
                    </dd>
                  </div>
                </dl>
                {me && ok ? (
                  <Trade
                    me={me}
                    m={current}
                    pos={positions.data?.get(current.id.toString())}
                    onDone={() => {
                      void markets.refetch();
                      void positions.refetch();
                    }}
                  />
                ) : (
                  <p className="hint">{me ? "Authorise Predictions above to trade." : "Connect QoreX to trade."}</p>
                )}
              </section>
            )}
          </div>
          {!client && <p className="hint">Connecting to the testnet…</p>}
        </>
      )}
    </section>
  );
}
