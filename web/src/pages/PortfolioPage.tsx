import { useConnectQorex } from "../components/QorexConnect";
import { useAccount } from "wagmi";
import { Link } from "react-router-dom";
import { IconAlert } from "../components/Icons";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { displayAmount } from "../lib/amount";
import { usePayments } from "../lib/payments";
import { useCoins } from "../lib/coins";
import { useHeldEditions } from "../lib/editions";
import { EDITIONS } from "../config/contracts";
import { useBalances, useNfts } from "../lib/portfolio";

export function PortfolioPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect: openConnectModal } = useConnectQorex();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const balances = useBalances(me);
  const nfts = useNfts(me);
  const editions = useHeldEditions(me);
  const payments = usePayments(me);
  const coins = useCoins(me);


  if (!me) {
    return (
      <section className="sheet" aria-labelledby="pf-title">
        <div className="sheet__head">
          <h1 id="pf-title">Portfolio</h1>
          <p className="muted">Your tokens, NFTs and payments in escrow.</p>
        </div>
        <div className="panel empty">
          <h2>Connect your wallet to see your portfolio</h2>
          <button className="btn" type="button" onClick={openConnectModal}>
            Connect QoreX
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
        <p className="muted">
          Your assets: tokens, NFTs and payments waiting in escrow. Testnet only: they have no value. Every transaction is in <Link to="/history">History</Link>.
        </p>
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
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <caption className="visually-hidden">Token balances</caption>
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balances.data.rows.map((r) => (
                    <tr key={r.token.symbol}>
                      <th scope="row">{r.token.symbol}</th>
                      <td className="num fig">{displayAmount(r.token.address ? r.evm + r.bank : r.evm, r.token.decimals)}</td>
                    </tr>
                  ))}
                  {balances.data.cw20.map((c) => (
                    <tr key={c.symbol}>
                      <th scope="row">
                        {c.symbol} <span className="hint">CosmWasm CW20, read only</span>
                      </th>
                      <td className="num fig">{displayAmount(c.balance, c.decimals)}</td>
                    </tr>
                  ))}
                  {coins.data
                    ?.filter((c) => c.mine && c.mine.balance > 0n)
                    .map((c) => (
                      <tr key={c.address}>
                        <th scope="row">
                          {c.symbol} <span className="hint">launched in Qrow, testnet memecoin</span>
                        </th>
                        <td className="num fig">{displayAmount(c.mine!.balance, 18)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="hint">Your addresses on each QoreChain lane</summary>
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
            </details>
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
                <Link className="btn btn--quiet" to={`/nft/genesis/${n.id}`}>
                  Send or list
                </Link>
                {n.listed && (
                  <p className="hint fig">
                    Listed at {displayAmount(n.listed.price, n.listed.currency === "0x0000000000000000000000000000000000000000" ? 18 : tokenBySymbol("fUSD")!.decimals)}{" "}
                    {n.listed.currency === "0x0000000000000000000000000000000000000000" ? "QOR" : "fUSD"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ed-title" className="stack">
        <div className="section-head">
          <h2 id="ed-title">NFTs you created or collected</h2>
          <Link className="btn btn--quiet" to="/create">
            Create NFT
          </Link>
        </div>
        {editions.isPending && EDITIONS && <span className="skeleton" style={{ width: 160, height: 160 }} />}
        {(!EDITIONS || editions.data?.length === 0) && <p className="muted">None yet. Create your own in the NFT Shop, or buy one on the NFT Market.</p>}
        {editions.data && editions.data.length > 0 && (
          <ul className="nftgrid">
            {editions.data.map((n) => (
              <li key={n.id.toString()} className="nftcard">
                {n.image ? <img src={n.image} alt={n.name} width={160} height={160} loading="lazy" /> : <span className="skeleton" style={{ width: 160, height: 160 }} />}
                <p className="nftcard__name">{n.name}</p>
                <p className="hint fig">
                  {n.balance.toString()} of {n.supply.toString()}
                </p>
                <Link className="btn btn--quiet" to={`/nft/edition/${n.id}`}>
                  Send or list
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pend-title" className="stack">
        <h2 id="pend-title">In escrow</h2>
        <p className="fig">
          {pendingIn.length} waiting for you, {pendingOut.length} you sent still in escrow
        </p>
      </section>

    </section>
  );
}
