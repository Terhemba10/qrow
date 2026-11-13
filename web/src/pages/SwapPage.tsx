import { useConnectModal } from "@rainbow-me/rainbowkit";
import { evmToQor } from "@qorechain/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { IconAlert, IconCheck } from "../components/Icons";
import { TxHash, type TxStatus } from "../components/TxHash";
import { CHAIN } from "../config/network";
import { displayAmount, formatUnitsExact, parseAmount } from "../lib/amount";
import { bankBalances } from "../lib/faucet";
import { qorexAccount, qorexAvailable, signInQorex } from "../lib/staking";
import {
  coinByDenom,
  DEFAULT_SLIPPAGE_BPS,
  maxSwappable,
  minReceived,
  partnersOf,
  poolFor,
  quoteExactIn,
  SLIPPAGE_CHOICES_BPS,
  SLIPPAGE_WARN_BPS,
  spotRate,
  SWAP_COINS,
  SWAP_GAS,
  swapFromEvents,
  swapMsg,
  swapProblems,
  usePools,
  type Quote,
  type SwapCoin,
} from "../lib/swap";
import { waitForTx } from "../lib/tx";

type Done = { hash: string; status: TxStatus; height?: number; time?: string; got?: bigint; spent?: bigint; coinIn: SwapCoin; coinOut: SwapCoin; error?: string };

const rateText = (r: number) => (r >= 1000 ? r.toLocaleString(undefined, { maximumFractionDigits: 2 }) : r.toPrecision(6).replace(/\.?0+$/, ""));

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Swap tab: QOR, fUSD, fETH and fBTC on QoreChain's native AMM, signed in QoreX. Quotes and limits come
 * from the chain; Qrow checks everything the chain would refuse before QoreX is asked.
 */
export function SwapPage() {
  const ids = { amt: useId(), from: useId(), to: useId() };
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const qor = me ? evmToQor(me) : undefined;

  const pools = usePools();
  const balances = useQuery({ queryKey: ["swap-bal", qor], enabled: !!qor, refetchInterval: 20_000, queryFn: () => bankBalances(qor!) });

  const [inDenom, setInDenom] = useState<string>(SWAP_COINS[0].denom);
  const [outDenom, setOutDenom] = useState<string>(SWAP_COINS[1].denom);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [busy, setBusy] = useState<false | "qorex" | "chain">(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Done>();

  const coinIn = coinByDenom(inDenom)!;
  const coinOut = coinByDenom(outDenom)!;
  const list = pools.data ?? [];
  const pool = poolFor(list, inDenom, outDenom);
  const partners = partnersOf(list, inDenom);

  // Keep the "to" coin valid for the chosen "from" coin.
  useEffect(() => {
    if (pools.data && !poolFor(pools.data, inDenom, outDenom) && partners[0]) setOutDenom(partners[0].denom);
  }, [pools.data, inDenom, outDenom, partners]);

  const parsed = parseAmount(amount, coinIn.decimals);
  const amountIn = parsed.ok ? parsed.units : 0n;
  const debounced = useDebounced(amountIn, 400);
  const quote = useQuery({
    queryKey: ["swap-quote", pool?.id, inDenom, debounced.toString()],
    enabled: !!pool && debounced > 0n,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: () => quoteExactIn(pool!.id, inDenom, debounced),
  });
  const q: Quote | undefined = quote.data && debounced === amountIn ? quote.data : undefined;

  const balIn = balances.data?.[coinIn.denom] ?? 0n;
  const balQor = balances.data?.uqor ?? 0n;
  const problems = useMemo(
    () => (balances.data && amountIn > 0n ? swapProblems({ coinIn, amountIn, balanceIn: balIn, balanceQor: balQor, quote: q, slippageBps: slippage }) : []),
    [balances.data, amountIn, coinIn, balIn, balQor, q, slippage],
  );
  const minOut = q ? minReceived(q.amountOut, slippage) : 0n;
  const canSwap = !!qor && !!pool && !!q && problems.length === 0 && !busy && qorexAvailable();

  const flip = () => {
    if (!poolFor(list, outDenom, inDenom)) return;
    setInDenom(outDenom);
    setOutDenom(inDenom);
    setAmount("");
  };

  async function swap() {
    if (!qor || !pool || !q) return;
    setError(undefined);
    setDone(undefined);
    setBusy("qorex");
    try {
      const signer = await qorexAccount();
      if (!signer) throw new Error("QoreX didn’t share an account. Unlock QoreX and try again.");
      if (signer !== qor) throw new Error("QoreX is on a different account from the one Qrow shows. Choose the same account in QoreX, then try again.");
      // Re-quote right before signing: if the rate moved below the minimum, show the new numbers instead.
      const fresh = await quoteExactIn(pool.id, inDenom, amountIn);
      if (fresh.amountOut < minOut) {
        void quote.refetch();
        throw new Error(`The rate just changed: you would now get about ${displayAmount(fresh.amountOut, coinOut.decimals)} ${coinOut.symbol}. Check the new numbers and swap again.`);
      }
      const r = await signInQorex([swapMsg(qor, pool.id, coinIn, amountIn, coinOut, minOut)], "Qrow swap", SWAP_GAS);
      const base: Done = { hash: r.txHash, status: "pending", coinIn, coinOut };
      setDone(base);
      setAmount("");
      setBusy("chain");
      const t = await waitForTx(r.txHash);
      if (!t) setDone({ ...base, error: "Sent, but not confirmed yet. It usually takes a few seconds: check the explorer in a minute." });
      else if (t.code !== 0) setDone({ ...base, status: "failed", height: t.height, time: t.time, error: plainSwapError(t.rawLog) });
      else {
        const s = swapFromEvents(t.events);
        setDone({ ...base, status: "confirmed", height: t.height, time: t.time, got: s?.amountOut, spent: s?.amountIn });
      }
      void balances.refetch();
      void pools.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QoreX refused the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page" aria-labelledby="swap-title">
      <div className="sheet__head">
        <h1 id="swap-title">Swap</h1>
        <p className="muted">Swap test tokens on QoreChain’s built-in exchange, signed in QoreX. Test tokens have no real value.</p>
      </div>

      <div className="split">
        <section className="panel stack" aria-labelledby="swap-form">
          <h2 id="swap-form" className="visually-hidden">
            Swap details
          </h2>

          <div className="field">
            <label htmlFor={ids.amt}>You pay</label>
            <div className="amount-row">
              <input id={ids.amt} className="input fig" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-describedby={`${ids.amt}-bal`} />
              <select id={ids.from} aria-label="Coin you pay" className="input" value={inDenom} onChange={(e) => (setInDenom(e.target.value), setAmount(""))}>
                {SWAP_COINS.filter((c) => partnersOf(list, c.denom).length > 0 || !pools.data).map((c) => (
                  <option key={c.denom} value={c.denom}>
                    {c.symbol}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint row" id={`${ids.amt}-bal`}>
              {qor ? (
                <>
                  <span className="fig">
                    Balance: {balances.data ? displayAmount(balIn, coinIn.decimals) : "…"} {coinIn.symbol}
                  </span>
                  {balances.data && maxSwappable(coinIn, balIn) > 0n && (
                    <button className="linkish" type="button" onClick={() => setAmount(formatUnitsExact(maxSwappable(coinIn, balIn), coinIn.decimals))}>
                      Max
                    </button>
                  )}
                </>
              ) : (
                "Connect QoreX to see your balance."
              )}
            </p>
            {amount.trim() !== "" && !parsed.ok && (
              <p className="field-error">
                <IconAlert /> {parsed.reason === "decimals" ? `${coinIn.symbol} has at most ${coinIn.decimals} decimals.` : parsed.reason === "zero" ? "Enter more than zero." : "Enter a number, like 2.5."}
              </p>
            )}
          </div>

          <div className="row">
            <button className="btn btn--quiet" type="button" onClick={flip} disabled={!poolFor(list, outDenom, inDenom)} aria-label={`Swap direction: pay ${coinOut.symbol}, receive ${coinIn.symbol}`}>
              ↑↓ Switch
            </button>
          </div>

          <div className="field">
            <label htmlFor={ids.to}>You receive (about)</label>
            <div className="amount-row">
              <output className="input fig swap-out" aria-live="polite">
                {q ? displayAmount(q.amountOut, coinOut.decimals) : quote.isFetching && amountIn > 0n ? "…" : "0"}
              </output>
              <select id={ids.to} aria-label="Coin you receive" className="input" value={outDenom} onChange={(e) => setOutDenom(e.target.value)}>
                {partners.map((c) => (
                  <option key={c.denom} value={c.denom}>
                    {c.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Slippage limit</legend>
            <div className="seg" role="radiogroup">
              {SLIPPAGE_CHOICES_BPS.map((b) => (
                <span key={b}>
                  <input type="radio" id={`slip-${b}`} name="slippage" checked={slippage === b} onChange={() => setSlippage(b)} />
                  <label htmlFor={`slip-${b}`}>{b / 100}%</label>
                </span>
              ))}
            </div>
            {slippage >= SLIPPAGE_WARN_BPS && <p className="hint">A wide limit lets the price move more against you before the swap is refused.</p>}
          </fieldset>

          {pools.isError && <p className="hint">Couldn’t read the exchange’s pools just now. Qrow keeps trying.</p>}
          {pools.data && !pool && <p className="hint">There’s no pool for {coinIn.symbol} and {coinOut.symbol} yet, so this pair can’t be swapped.</p>}
          {quote.isError && <p className="field-error"><IconAlert /> {(quote.error as Error).message}</p>}

          {problems.map((p) => (
            <p key={p.id} className="field-error">
              <IconAlert /> {p.text}
              {p.id === "fee" && (
                <>
                  {" "}
                  <Link to="/faucet">Get test tokens</Link>
                </>
              )}
            </p>
          ))}

          {!qor ? (
            <button className="btn btn--block" type="button" onClick={openConnectModal}>
              Connect QoreX
            </button>
          ) : !qorexAvailable() ? (
            <p className="notice notice--warn">Swaps are signed in QoreX. Open Qrow in a browser with the QoreX extension, or in the QoreX app’s dApp Browser.</p>
          ) : (
            <button className="btn btn--block" type="button" disabled={!canSwap} onClick={() => void swap()}>
              {busy === "qorex" ? "Confirm in QoreX…" : busy === "chain" ? "Waiting for the chain…" : q ? `Swap ${displayAmount(amountIn, coinIn.decimals)} ${coinIn.symbol} in QoreX` : "Enter an amount"}
            </button>
          )}
          {error && (
            <p className="field-error" role="alert">
              <IconAlert /> {error}
            </p>
          )}
        </section>

        <section className="stack" aria-labelledby="swap-sum">
          <h2 id="swap-sum">Details</h2>
          {pool ? (
            <dl className="facts">
              <div>
                <dt>Pool price</dt>
                <dd className="fig">
                  1 {coinIn.symbol} ≈ {rateText(spotRate(pool, inDenom))} {coinOut.symbol}
                </dd>
              </div>
              {q && (
                <>
                  <div>
                    <dt>Minimum you receive</dt>
                    <dd className="fig">
                      {displayAmount(minOut, coinOut.decimals)} {coinOut.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Exchange fee (0.30%)</dt>
                    <dd className="fig">
                      {displayAmount(q.fee, coinIn.decimals)} {coinIn.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Price impact</dt>
                    <dd className="fig">{(q.impactBps / 100).toFixed(2)}%</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Network fee</dt>
                <dd className="fig">about 0.06 QOR, set by QoreX</dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd className="fig">
                  #{pool.id}: {displayAmount(pool.reserveA, pool.a.decimals)} {pool.a.symbol} and {displayAmount(pool.reserveB, pool.b.decimals)} {pool.b.symbol}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="hint">{pools.isLoading ? "Reading the pools…" : "Choose two coins that share a pool."}</p>
          )}
          <p className="hint">
            The chain refuses a swap that moves the pool price by more than 5%, or that would pay you less than the minimum. Coins swap as native (bank) coins, the way the faucet pays them.
          </p>

          {done && (
            <div className={`notice ${done.status === "failed" ? "notice--danger" : done.status === "confirmed" ? "notice--ok" : ""}`} role="status" aria-live="polite">
              <p className="notice__title">
                {done.status === "confirmed" ? (
                  <>
                    <IconCheck /> Swap confirmed
                  </>
                ) : done.status === "failed" ? (
                  <>
                    <IconAlert /> Swap failed
                  </>
                ) : (
                  "Swap sent"
                )}
              </p>
              {done.status === "confirmed" && done.got !== undefined && (
                <p className="fig">
                  You paid {displayAmount(done.spent ?? 0n, done.coinIn.decimals)} {done.coinIn.symbol} and received {displayAmount(done.got, done.coinOut.decimals)} {done.coinOut.symbol}.
                </p>
              )}
              {done.error && <p>{done.error}</p>}
              <TxHash hash={done.hash} status={done.status} height={done.height} time={done.time} />
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function plainSwapError(log: string): string {
  if (/impact/i.test(log)) return "The trade moved the pool price too much, so the chain refused it. Nothing was swapped: try a smaller amount.";
  if (/slippage|min.?out|less than/i.test(log)) return "The price moved past your slippage limit before the swap ran. Nothing was swapped: try again.";
  if (/insufficient/i.test(log)) return "Not enough balance for the swap and the network fee. Nothing was swapped.";
  return `The chain refused it: ${log.slice(0, 160)}`;
}
