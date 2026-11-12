import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { IconAlert } from "../components/Icons";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { short } from "../lib/address";
import { displayAmount } from "../lib/amount";
import { usePayments } from "../lib/payments";
import { downloadCsv, useBalances, useNfts, type ActivityRow } from "../lib/portfolio";

const STATUS_WORD: Record<string, string> = { Pending: "Waiting", Claimed: "Claimed", Released: "Released", Cancelled: "Cancelled", Refunded: "Refunded" };
const fmtDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function PortfolioPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const balances = useBalances(me);
  const nfts = useNfts(me);
  const payments = usePayments(me);

  const activity = useMemo<ActivityRow[]>(() => {
    if (!payments.data || !me) return [];
    const rows: ActivityRow[] = [
      ...payments.data.outgoing.map((p) => ({ time: p.createdAt, kind: "Payment sent", ref: `#${p.id}`, amount: `${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol}`, counterparty: p.recipient, status: STATUS_WORD[p.status] ?? p.status, tx: p.createdTx })),
      ...payments.data.incoming.map((p) => ({ time: p.createdAt, kind: "Payment received", ref: `#${p.id}`, amount: `${displayAmount(p.amount, p.token.decimals)} ${p.token.symbol}`, counterparty: p.sender, status: STATUS_WORD[p.status] ?? p.status, tx: p.createdTx })),
    ];
    return rows.sort((a, b) => b.time - a.time);
  }, [payments.data, me]);

  if (!me) {
    return (
      <section className="sheet" aria-labelledby="pf-title">
        <div className="sheet__head">
          <h1 id="pf-title">Portfolio</h1>
          <p className="muted">Your balances, NFTs, listings and payments across QoreChain’s lanes.</p>
        </div>
        <div className="panel empty">
          <h2>Connect your wallet to see your portfolio</h2>
          <button className="btn" type="button" onClick={openConnectModal}>
            Connect wallet
          </button>
        </div>
      </section>
    );
  }

  const pendingIn = payments.data?.incoming.filter((p) => p.status === "Pending") ?? [];
  const pendingOut = payments.data?.outgoing.filter((p) => p.status === "Pending") ?? [];

  return (
    <section className="page" aria-labelledby="pf-title">
      <div className="sheet__head">
        <h1 id="pf-title">Portfolio</h1>
        <p className="muted">Testnet balances: these tokens have no value.</p>
      </div>

      <section aria-labelledby="bal-title" className="stack">
        <h2 id="bal-title">Balances</h2>
        {balances.isPending && <span className="skeleton" style={{ width: "60%", height: 120 }} />}
        {balances.isError && (
          <div className="notice notice--warn" role="alert">
            <p className="notice__title">
              <IconAlert /> Couldn’t read your balances
            </p>
            <button className="btn" type="button" onClick={() => void balances.refetch()}>
              Try again
            </button>
          </div>
        )}
        {balances.data && (
          <>
            <table className="table">
              <caption className="visually-hidden">Token balances by lane</caption>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col" className="num">EVM (usable by Qrow)</th>
                  <th scope="col" className="num">Native lane, not converted</th>
                </tr>
              </thead>
              <tbody>
                {balances.data.rows.map((r) => (
                  <tr key={r.token.symbol}>
                    <th scope="row">{r.token.symbol}</th>
                    <td className="num fig">{displayAmount(r.evm, r.token.decimals)}</td>
                    <td className="num fig">{r.token.address ? displayAmount(r.bank, r.token.decimals) : "same balance"}</td>
                  </tr>
                ))}
                {balances.data.cw20.map((c) => (
                  <tr key={c.symbol}>
                    <th scope="row">
                      {c.symbol} <span className="hint">CosmWasm CW20, read only</span>
                    </th>
                    <td className="num muted">n/a</td>
                    <td className="num fig">{displayAmount(c.balance, c.decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {balances.data.rows.some((r) => r.token.address && r.evm === 0n && r.bank > 0n) && (
              <p className="hint">Fest tokens on the native lane must be converted (MsgConvertCoin, in QoreX) before Qrow’s EVM contracts can use them.</p>
            )}
            <dl className="facts lanes">
              <div>
                <dt>EVM</dt>
                <dd className="mono">{balances.data.addresses.evm}</dd>
              </div>
              <div>
                <dt>Native</dt>
                <dd className="mono">{balances.data.addresses.cosmos}</dd>
              </div>
              <div>
                <dt>SVM</dt>
                <dd>
                  <span className="mono">{balances.data.addresses.svm}</span>
                  <span className="hint"> (the SVM lane is disabled for transactions on testnet)</span>
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section aria-labelledby="nft-title" className="stack">
        <h2 id="nft-title">Qrow Genesis NFTs</h2>
        {nfts.isPending && <span className="skeleton" style={{ width: 160, height: 160 }} />}
        {nfts.data && nfts.data.length === 0 && <p className="muted">You don’t own any Genesis NFTs yet. Mint one in the NFT Shop.</p>}
        {nfts.data && nfts.data.length > 0 && (
          <ul className="nftgrid">
            {nfts.data.map((n) => (
              <li key={n.id.toString()} className="nftcard">
                {n.image ? <img src={n.image} alt={`${n.name}, generative loops artwork`} width={160} height={160} /> : <span className="skeleton" style={{ width: 160, height: 160 }} />}
                <p className="nftcard__name">{n.name}</p>
                {n.listed && (
                  <p className="hint fig">
                    Listed at {displayAmount(n.listed.price, n.listed.currency === "0x0000000000000000000000000000000000000000" ? 18 : tokenBySymbol("fUSD")!.decimals)} {n.listed.currency === "0x0000000000000000000000000000000000000000" ? "QOR" : "fUSD"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pend-title" className="stack">
        <h2 id="pend-title">Pending payments</h2>
        <p className="fig">
          {pendingIn.length} waiting for you, {pendingOut.length} you sent still in escrow
        </p>
      </section>

      <section aria-labelledby="act-title" className="stack">
        <div className="section-head">
          <h2 id="act-title">Activity</h2>
          <button className="btn btn--quiet" type="button" disabled={!activity.length} onClick={() => downloadCsv(activity, `qrow-activity-${me.slice(2, 8)}.csv`)}>
            Export CSV
          </button>
        </div>
        {payments.isPending && <span className="skeleton" style={{ width: "80%" }} />}
        {payments.data && activity.length === 0 && <p className="muted">No payments yet.</p>}
        {activity.length > 0 && (
          <table className="table">
            <caption className="visually-hidden">Payments sent and received</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Payment</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">With</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((r) => (
                <tr key={`${r.kind}${r.ref}`}>
                  <td>{fmtDate.format(new Date(r.time * 1000))}</td>
                  <td>{r.kind}</td>
                  <td className="fig">{r.ref}</td>
                  <td className="num fig">{r.amount}</td>
                  <td className="mono" title={r.counterparty}>
                    {short(r.counterparty)}
                  </td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
