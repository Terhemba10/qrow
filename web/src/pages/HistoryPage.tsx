import { evmToQor } from "@qorechain/sdk";
import { Button, EmptyState, Skeleton } from "../ds";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { useConnectQorex } from "../components/QorexConnect";
import { AGENT, CHAIN } from "../config/network";
import { short } from "../lib/address";
import { displayAmount } from "../lib/amount";
import { usePayments } from "../lib/payments";
import { useReceipts } from "../lib/receipts";
import { EXPLORER_TX } from "../lib/tx";

/** One transaction = one row (a flow's set-up steps are their own rows too). */
interface Row {
  time: number; // ms
  kind: string;
  what: string;
  hash: string;
  /** The action this set-up step belonged to. */
  partOf?: string;
}

const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function CopyHash({ hash }: { hash: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="linkbtn mono"
      type="button"
      title={`Copy ${hash}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(hash);
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "Copied" : `${hash.slice(0, 8)}…${hash.slice(-6)}`}
    </button>
  );
}

function toCsv(rows: Row[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["date_utc,type,what,part_of,tx_hash", ...rows.map((r) => [new Date(r.time).toISOString(), r.kind, r.what, r.partOf ?? "", r.hash].map(esc).join(","))].join("\n");
}

export function HistoryPage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const receipts = useReceipts(address);
  const payments = usePayments(me);
  const [filter, setFilter] = useState("All");
  const referrals = useQuery({
    queryKey: ["referrals", me],
    enabled: !!me,
    staleTime: 300_000,
    queryFn: async () => {
      const r = await fetch(`${AGENT}/referrals/${evmToQor(me!)}`);
      if (!r.ok) throw new Error("unavailable");
      return ((await r.json()) as { count: number }).count;
    },
  });

  const rows = useMemo<Row[]>(() => {
    const out = new Map<string, Row>();
    for (const r of receipts) {
      const t = Date.parse(r.at);
      out.set(r.hash.toLowerCase(), { time: t, kind: r.kind, what: r.title, hash: r.hash });
      (r.steps ?? []).forEach((s, i) => {
        if (!out.has(s.hash.toLowerCase())) out.set(s.hash.toLowerCase(), { time: t - (i + 1), kind: "Set-up step", what: s.label, hash: s.hash, partOf: r.title });
      });
    }
    // Escrow payments read from the chain (also those made in another browser).
    for (const p of payments.data?.outgoing ?? [])
      if (p.createdTx && !out.has(p.createdTx.toLowerCase()))
        out.set(p.createdTx.toLowerCase(), { time: p.createdAt * 1000, kind: "Payment", what: `Sent ${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol} to ${short(p.recipient)} (#${p.id}, ${p.status})`, hash: p.createdTx });
    for (const p of payments.data?.incoming ?? [])
      if (p.createdTx && !out.has(p.createdTx.toLowerCase()))
        out.set(p.createdTx.toLowerCase(), { time: p.createdAt * 1000, kind: "Payment", what: `Received ${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol} from ${short(p.sender)} (#${p.id}, ${p.status})`, hash: p.createdTx });
    return [...out.values()].sort((a, b) => b.time - a.time);
  }, [receipts, payments.data]);

  const kinds = ["All", ...new Set(rows.map((r) => r.kind))];
  const shown = rows.filter((r) => filter === "All" || r.kind === filter);

  if (!me)
    return (
      <section className="page" aria-labelledby="hist-title">
        <div className="sheet__head">
          <h1 id="hist-title">History</h1>
          <p className="muted">Every transaction you make on Qrow, each with its own hash.</p>
        </div>
        <EmptyState
          title="Your transactions appear here"
          text="Connect QoreX to see every transaction you made on Qrow, each with its own hash to check."
          action={<Button onClick={connect}>Connect QoreX</Button>}
        />
      </section>
    );

  return (
    <section className="page" aria-labelledby="hist-title">
      <div className="sheet__head">
        <h1 id="hist-title">History</h1>
        <p className="muted">
          Every transaction, newest first, each with its own hash. Set-up steps that ran inside an action are listed separately. Check any of them on <Link to="/verify">Verify</Link> or the explorer.
        </p>
      </div>

      <div className="section-head">
        {rows.length > 0 ? (
          <div className="seg" role="radiogroup" aria-label="Type">
            {kinds.map((k) => (
              <span key={k}>
                <input type="radio" id={`hk-${k}`} name="hist-kind" checked={filter === k} onChange={() => setFilter(k)} />
                <label htmlFor={`hk-${k}`}>{k}</label>
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        <button
          className="btn btn--quiet"
          type="button"
          disabled={!rows.length}
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
            a.download = `qrow-history-${me.slice(2, 8)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Export CSV
        </button>
      </div>

      {payments.isPending && rows.length === 0 && <span className="skeleton" style={{ width: "80%" }} />}
      {payments.isPending && rows.length === 0 && <Skeleton lines={4} />}
      {rows.length === 0 && !payments.isPending && <EmptyState title="No transactions yet" text="Each one you make shows up here with its own hash, so you can check it any time." action={<Button to="/trade" variant="cyan">Make your first trade</Button>} />}
      {shown.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <caption className="visually-hidden">Your transactions</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">What</th>
                <th scope="col">Transaction</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.hash}>
                  <td>{fmt.format(new Date(r.time))}</td>
                  <td>{r.kind}</td>
                  <td>
                    {r.what}
                    {r.partOf && <span className="hint"> (part of: {r.partOf})</span>}
                  </td>
                  <td>
                    <CopyHash hash={r.hash} />
                  </td>
                  <td>
                    <Link to={`/verify?q=${encodeURIComponent(r.hash)}`}>Verify</Link> ·{" "}
                    <a href={EXPLORER_TX(r.hash)} target="_blank" rel="noopener noreferrer">
                      Explorer
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Actions are remembered in this browser; escrow payments are also read from the chain, so they show on any device.</p>

      <section aria-labelledby="ref-title" className="stack">
        <h2 id="ref-title">Referrals</h2>
        {referrals.data !== undefined ? (
          <p>
            <span className="fig">{referrals.data}</span> {referrals.data === 1 ? "person has" : "people have"} staked through your link. Tracking only: Qrow pays no commission.
          </p>
        ) : referrals.isError ? (
          <p className="muted">Referral counts are unavailable right now.</p>
        ) : (
          <span className="skeleton" style={{ width: "40%" }} />
        )}
        <p className="hint">
          Your link: <span className="mono">{`${window.location.origin}/?ref=${evmToQor(me)}`}</span>
        </p>
      </section>
    </section>
  );
}
