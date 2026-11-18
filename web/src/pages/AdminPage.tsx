import { useQuery } from "@tanstack/react-query";
import { StatCard } from "../ds";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowCoinFactoryAbi } from "../abi/QrowCoinFactory";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { qrowPredictAbi } from "../abi/QrowPredict";
import { PqActionPanel } from "../components/PqActionPanel";
import { COIN_FACTORY, GENESIS, isAdmin, MARKET, PREDICT } from "../config/contracts";
import { CHAIN, ESCROW } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { parseAmount } from "../lib/amount";
import { Outcome, pct, useMarkets } from "../lib/predict";

const FUSD = tokenBySymbol("fUSD")!;

/** Public, read-only numbers straight from the testnet contracts (anyone can check them). */
function useAnalytics() {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["admin-analytics"],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async () => {
      const c = client!;
      const safe = <T,>(p: Promise<T>) => p.catch(() => undefined);
      const [payments, minted, listings, coins, markets] = await Promise.all([
        safe(c.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" })),
        safe(c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "totalMinted" })),
        safe(c.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "listingCount" })),
        safe(c.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "coinCount" })),
        PREDICT ? safe(c.readContract({ address: PREDICT, abi: qrowPredictAbi, functionName: "marketCount" })) : undefined,
      ]);
      return { payments, minted, listings, coins, markets };
    },
  });
}

function CreateMarket({ me, onDone }: { me: Address; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Crypto");
  const [end, setEnd] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [liq, setLiq] = useState("20");
  const [signing, setSigning] = useState(false);
  const parsed = parseAmount(liq, FUSD.decimals);
  const endTs = BigInt(Math.floor(new Date(`${end}T23:59:00Z`).getTime() / 1000));
  const valid = q.trim().length >= 10 && q.length <= 200 && parsed.ok && parsed.units >= 1_000_000n && Number(endTs) > Date.now() / 1000;
  if (signing && parsed.ok)
    return (
      <PqActionPanel
        sender={me}
        contract={PREDICT!}
        title="Create market"
        summary={<p className="muted">{q}</p>}
        approve={{ token: FUSD.address!, amount: parsed.units, label: "fUSD" }}
        build={() => ({ abi: qrowPredictAbi, functionName: "createMarket", args: [q.trim(), cat.trim(), endTs, parsed.units] })}
        confirmLabel="Create in QoreX"
        details={[
          { name: "Ends", value: `${end} 23:59 UTC` },
          { name: "Liquidity", value: `${liq} fUSD (returned with fees after resolution)` },
        ]}
        receipt={() => ({ kind: "Admin", title: "Created a prediction market", lines: [{ name: "Question", value: q }] })}
        onDone={() => {
          setSigning(false);
          setQ("");
          onDone();
        }}
        onCancel={() => setSigning(false)}
      />
    );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) setSigning(true);
      }}
    >
      <label className="field">
        <span>Question (a clear YES/NO with a source and date)</span>
        <input className="input" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Will ETH close above $4,000 on 31 Dec 2026 (Binance daily close)?" />
      </label>
      <div className="row">
        <label className="field">
          <span>Category</span>
          <input className="input" value={cat} maxLength={32} onChange={(e) => setCat(e.target.value)} />
        </label>
        <label className="field">
          <span>Ends (UTC)</span>
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span>Liquidity (fUSD, min 1)</span>
          <input className="input" inputMode="decimal" value={liq} onChange={(e) => setLiq(e.target.value)} />
        </label>
      </div>
      <button className="btn" type="submit" disabled={!valid}>
        Review market
      </button>
    </form>
  );
}

function Resolve({ me, id, question, onDone }: { me: Address; id: bigint; question: string; onDone: () => void }) {
  const [pick, setPick] = useState<Outcome>();
  if (pick === undefined)
    return (
      <div className="row">
        {[Outcome.Yes, Outcome.No, Outcome.Invalid].map((o) => (
          <button key={o} className="btn btn--quiet" type="button" onClick={() => setPick(o)}>
            Resolve {Outcome[o].toUpperCase()}
          </button>
        ))}
      </div>
    );
  return (
    <PqActionPanel
      sender={me}
      contract={PREDICT!}
      title={`Resolve: ${Outcome[pick].toUpperCase()}`}
      summary={<p className="muted">{question} Claims open after a 1-hour dispute delay, during which you can correct the result.</p>}
      build={() => ({ abi: qrowPredictAbi, functionName: "resolve", args: [id, pick] })}
      confirmLabel="Resolve in QoreX"
      receipt={() => ({ kind: "Admin", title: `Resolved market #${id} as ${Outcome[pick]}`, lines: [{ name: "Question", value: question }] })}
      onDone={() => {
        setPick(undefined);
        onDone();
      }}
      onCancel={() => setPick(undefined)}
    />
  );
}

export function AdminPage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const a = useAnalytics();
  const markets = useMarkets();
  const admin = isAdmin(me);
  const now = Date.now() / 1000;

  return (
    <section className="page" aria-labelledby="admin-title">
      <div className="sheet__head">
        <h1 id="admin-title">Admin &amp; Analytics</h1>
        <p className="muted">Live numbers read from Qrow’s testnet contracts. Admin controls appear only for Qrow’s admin address; no admin key can move anyone’s funds or NFTs.</p>
      </div>
      <div className="hub__stats hub__stats--6">
        <StatCard tone="cyan" label="Escrow payments" value={a.data?.payments !== undefined ? Number(a.data.payments) : undefined} unit="sent" />
        <StatCard tone="orange" label="Genesis NFTs minted" value={a.data?.minted !== undefined ? Number(a.data.minted) : undefined} unit="of 256" />
        <StatCard tone="mint" label="Prediction markets" value={a.data?.markets !== undefined ? Number(a.data.markets) : PREDICT ? undefined : 0} unit="markets" />
        <StatCard label="Market listings" value={a.data?.listings !== undefined ? Number(a.data.listings) : undefined} unit="all time" />
        <StatCard label="Coins launched" value={a.data?.coins !== undefined ? Number(a.data.coins) : undefined} unit="coins" />
        <StatCard label="Prediction volume" value={markets.data ? Number((markets.data ?? []).reduce((s, m) => s + m.volume, 0n)) / 1e6 : PREDICT ? undefined : 0} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} unit="fUSD" />
      </div>

      {admin && PREDICT && me && (
        <>
          <section className="panel stack" aria-labelledby="adm-create">
            <h2 id="adm-create">Create a prediction market</h2>
            <CreateMarket me={me} onDone={() => void markets.refetch()} />
          </section>
          <section className="panel stack" aria-labelledby="adm-resolve">
            <h2 id="adm-resolve">Resolve markets</h2>
            <ul className="stack">
              {(markets.data ?? []).map((m) => (
                <li key={m.id.toString()} className="stack">
                  <p>
                    <strong>#{m.id.toString()}</strong> {m.question}{" "}
                    <span className="hint">
                      ({m.resolved ? `resolved ${Outcome[m.outcome]}` : now < m.endTime ? `open, YES ${pct(m.yesProb)}, ends ${new Date(m.endTime * 1000).toLocaleDateString()}` : "ended: ready to resolve"})
                    </span>
                  </p>
                  {now >= m.endTime && (!m.resolved || now < m.resolvedAt + 3600) && <Resolve me={me} id={m.id} question={m.question} onDone={() => void markets.refetch()} />}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {!admin && <p className="hint">Admin controls are hidden: connect with Qrow’s admin address to create and resolve prediction markets.</p>}
    </section>
  );
}
