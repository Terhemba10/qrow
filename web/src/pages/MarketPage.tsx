import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { encodeAbiParameters, erc20Abi, keccak256, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { marketChecks } from "../agent/marketChecks";
import { pastRecipients } from "../agent/recipients";
import { CheckList } from "../components/CheckList";
import { BigAddress } from "../components/ConfirmSheet";
import { PqActionPanel } from "../components/PqActionPanel";
import { GENESIS, MARKET } from "../config/contracts";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { short } from "../lib/address";
import { displayAmount, parseAmount } from "../lib/amount";
import { parseTokenUri, useNfts } from "../lib/portfolio";

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const FUSD = tokenBySymbol("fUSD")!;
const cur = (a: Address) => (a.toLowerCase() === ZERO ? { symbol: "QOR", decimals: 18 } : { symbol: "fUSD", decimals: FUSD.decimals });
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));

interface Row {
  id: bigint;
  seller: Address;
  tokenId: bigint;
  currency: Address;
  price: bigint;
  name: string;
  image?: string;
}

function useMarket() {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["market"],
    enabled: !!client,
    refetchInterval: 15_000,
    queryFn: async () => {
      const c = client!;
      const ids = await c.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "activeListingIds" });
      const rows: Row[] = await Promise.all(
        ids.map(async (id) => {
          const l = await c.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "getListing", args: [id] });
          const meta = parseTokenUri(await c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "tokenURI", args: [l.tokenId] }));
          return { id, seller: l.seller, tokenId: l.tokenId, currency: l.currency, price: l.price, ...meta };
        }),
      );
      const [floorQor, floorFusd] = await Promise.all([
        c.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "floorPrice", args: [ZERO] }),
        c.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "floorPrice", args: [FUSD.address!] }),
      ]);
      return { rows: rows.sort((a, b) => (a.price < b.price ? -1 : 1)), floor: { qor: floorQor[0], fusd: floorFusd[0] } };
    },
  });
}

export function MarketPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const client = usePublicClient({ chainId: CHAIN.id });
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const market = useMarket();
  const mine = useNfts(me);
  const [buying, setBuying] = useState<Row>();
  const [ack, setAck] = useState(false);
  const [signing, setSigning] = useState(false);

  const history = useQuery({ queryKey: ["market-history", me], enabled: !!me && !!client, queryFn: () => pastRecipients(client!, me!) });
  const balance = useQuery({
    queryKey: ["buy-balance", me, buying?.currency],
    enabled: !!me && !!buying && !!client,
    queryFn: () => (buying!.currency.toLowerCase() === ZERO ? client!.getBalance({ address: me! }) : client!.readContract({ address: buying!.currency, abi: erc20Abi, functionName: "balanceOf", args: [me!] })),
  });

  const floorFor = (currency: Address, excludeId?: bigint) => {
    const rows = (market.data?.rows ?? []).filter((r) => r.currency.toLowerCase() === currency.toLowerCase() && r.id !== excludeId);
    return rows.length ? rows.reduce((m, r) => (r.price < m ? r.price : m), rows[0].price) : undefined;
  };

  const buyChecks =
    buying && me && history.data && balance.data !== undefined
      ? marketChecks({
          side: "buy",
          price: buying.price,
          floor: floorFor(buying.currency, buying.id),
          counterparty: buying.seller,
          me,
          pastCounterparties: history.data.keys(),
          balance: balance.data,
          fmt: (u) => `${displayAmount(u, cur(buying.currency).decimals)} ${cur(buying.currency).symbol}`,
        })
      : undefined;
  const blocked = buyChecks?.some((c) => c.level === "block");
  const danger = buyChecks?.some((c) => c.level === "danger");
  const unlisted = (mine.data ?? []).filter((n) => !n.listed);
  const myListings = (market.data?.rows ?? []).filter((r) => me && r.seller.toLowerCase() === me.toLowerCase());

  return (
    <section className="page" aria-labelledby="mkt-title">
      <div className="sheet__head">
        <h1 id="mkt-title">NFT Market</h1>
        <p className="muted">Fixed-price listings for Qrow Genesis. The NFT waits in the market contract; buying pays the seller and hands over the NFT in one transaction. No fees. Testnet NFTs with no value.</p>
      </div>

      <div className="stats">
        <div>
          <p className="label">Floor (QOR)</p>
          <p className="fig stat">{market.data ? (market.data.floor.qor ? `${displayAmount(market.data.floor.qor, 18)} QOR` : "none") : "…"}</p>
        </div>
        <div>
          <p className="label">Floor (fUSD)</p>
          <p className="fig stat">{market.data ? (market.data.floor.fusd ? `${displayAmount(market.data.floor.fusd, FUSD.decimals)} fUSD` : "none") : "…"}</p>
        </div>
        <div>
          <p className="label">Listed</p>
          <p className="fig stat">{market.data ? market.data.rows.length : "…"}</p>
        </div>
      </div>

      {buying && me && (
        <section className="panel stack" aria-labelledby="buy-title">
          <h2 id="buy-title">
            Buy {buying.name} for {displayAmount(buying.price, cur(buying.currency).decimals)} {cur(buying.currency).symbol}
          </h2>
          <p className="label">Seller</p>
          <BigAddress address={buying.seller} label="Seller" />
          {!buyChecks && <span className="skeleton" style={{ width: "60%" }} />}
          {buyChecks && <CheckList run={{ results: buyChecks, totalMs: 0, startedAt: Date.now() }} />}
          {danger && (
            <label className="ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I’ve checked the seller’s full address, and I still want to buy.</span>
            </label>
          )}
          {!signing ? (
            <div className="row">
              <button className="btn btn--quiet" type="button" onClick={() => setBuying(undefined)}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={!buyChecks || blocked || (danger && !ack)} onClick={() => setSigning(true)}>
                Confirm &amp; Buy
              </button>
            </div>
          ) : (
            <PqActionPanel
              sender={me}
              contract={MARKET}
              title={`Buy listing #${buying.id}`}
              summary={<p className="muted">Signed with your quantum-safe key, which binds this exact price.</p>}
              pq={{ actionName: "ACTION_BUY", paramsHash: enc(["uint256", "uint256", "address", "uint256"], [buying.id, buying.tokenId, buying.currency, buying.price]) }}
              approve={buying.currency.toLowerCase() !== ZERO ? { token: buying.currency, amount: buying.price, label: `${displayAmount(buying.price, FUSD.decimals)} fUSD` } : undefined}
              build={(auth) => ({ abi: qrowMarketAbi, functionName: "buy", args: [buying.id, auth!.validUntil, auth!.signature], value: buying.currency.toLowerCase() === ZERO ? buying.price : 0n })}
              describeSimulation={() => `${displayAmount(buying.price, cur(buying.currency).decimals)} ${cur(buying.currency).symbol} goes to ${short(buying.seller)} and ${buying.name} comes to you, in one transaction.`}
              confirmLabel="Confirm and buy"
              onDone={() => {
                setSigning(false);
                setBuying(undefined);
                void market.refetch();
                void mine.refetch();
              }}
              onCancel={() => setSigning(false)}
            />
          )}
        </section>
      )}

      <section className="stack" aria-labelledby="listings-title">
        <h2 id="listings-title">Listings</h2>
        {market.isPending && <span className="skeleton" style={{ width: "100%", height: 180 }} />}
        {market.isError && <p className="field-error">Couldn’t load the market from the testnet.</p>}
        {market.data && market.data.rows.length === 0 && <p className="muted">Nothing listed yet. Own a Genesis NFT? List it below.</p>}
        {market.data && market.data.rows.length > 0 && (
          <ul className="nftgrid">
            {market.data.rows.map((r) => (
              <li key={r.id.toString()} className="nftcard">
                {r.image && <img src={r.image} alt={`${r.name}, generative loops artwork`} width={160} height={160} />}
                <p className="nftcard__name">{r.name}</p>
                <p className="fig">
                  {displayAmount(r.price, cur(r.currency).decimals)} {cur(r.currency).symbol}
                </p>
                <p className="hint">
                  Seller <span className="mono">{short(r.seller)}</span>
                </p>
                {me && r.seller.toLowerCase() !== me.toLowerCase() && (
                  <button className="btn" type="button" onClick={() => { setBuying(r); setAck(false); setSigning(false); }}>
                    Buy
                  </button>
                )}
                {!me && (
                  <button className="btn btn--quiet" type="button" onClick={openConnectModal}>
                    Connect to buy
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {me && (
        <section className="stack" aria-labelledby="sell-title">
          <h2 id="sell-title">Sell yours</h2>
          {mine.isPending && <span className="skeleton" style={{ width: 160, height: 160 }} />}
          {mine.data && unlisted.length === 0 && myListings.length === 0 && <p className="muted">You have no Genesis NFTs to list. Mint one in the NFT Shop.</p>}
          {(unlisted.length > 0 || myListings.length > 0) && (
            <ul className="nftgrid">
              {unlisted.map((n) => (
                <ListCard key={n.id.toString()} me={me} tokenId={n.id} name={n.name} image={n.image} floorFor={floorFor} history={history.data} onDone={() => { void market.refetch(); void mine.refetch(); }} />
              ))}
              {myListings.map((r) => (
                <UnlistCard key={r.id.toString()} me={me} row={r} onDone={() => { void market.refetch(); void mine.refetch(); }} />
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

function ListCard(props: { me: Address; tokenId: bigint; name: string; image?: string; floorFor: (c: Address) => bigint | undefined; history?: Map<string, number>; onDone: () => void }) {
  const id = useId();
  const [currency, setCurrency] = useState<"QOR" | "fUSD">("QOR");
  const [price, setPrice] = useState("");
  const [signing, setSigning] = useState(false);
  const [ack, setAck] = useState(false);
  const dec = currency === "QOR" ? 18 : FUSD.decimals;
  const curAddr = currency === "QOR" ? ZERO : FUSD.address!;
  const parsed = parseAmount(price, dec);
  const checks = parsed.ok ? marketChecks({ side: "list", price: parsed.units, floor: props.floorFor(curAddr), me: props.me, pastCounterparties: props.history?.keys() ?? [], fmt: (u) => `${displayAmount(u, dec)} ${currency}` }) : undefined;
  const warn = checks?.some((c) => c.level === "warn");
  return (
    <li className="nftcard">
      {props.image && <img src={props.image} alt={`${props.name}, generative loops artwork`} width={160} height={160} />}
      <p className="nftcard__name">{props.name}</p>
      {!signing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.ok && (!warn || ack)) setSigning(true);
          }}
        >
          <div className="seg">
            {(["QOR", "fUSD"] as const).map((c) => (
              <span key={c}>
                <input type="radio" name={`${id}-cur`} id={`${id}-${c}`} checked={currency === c} onChange={() => setCurrency(c)} />
                <label htmlFor={`${id}-${c}`}>{c}</label>
              </span>
            ))}
          </div>
          <label className="label" htmlFor={`${id}-price`}>
            Price
          </label>
          <input id={`${id}-price`} className="input fig" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          {checks?.filter((c) => c.level !== "ok").map((c) => (
            <p key={c.id} className={c.level === "warn" ? "field-error" : "hint"}>
              {c.title}. {c.detail}
            </p>
          ))}
          {warn && (
            <label className="ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>The price is right.</span>
            </label>
          )}
          <button className="btn" type="submit" disabled={!parsed.ok || (warn && !ack)}>
            List
          </button>
        </form>
      ) : (
        <PqActionPanel
          sender={props.me}
          contract={MARKET}
          title={`List ${props.name}`}
          summary={<p className="muted">The NFT moves into the market contract until it sells or you cancel. Signed with your quantum-safe key.</p>}
          pq={{ actionName: "ACTION_LIST", paramsHash: enc(["uint256", "address", "uint256"], [props.tokenId, curAddr, parsed.ok ? parsed.units : 0n]) }}
          build={(auth) => ({ abi: qrowMarketAbi, functionName: "list", args: [props.tokenId, curAddr, parsed.ok ? parsed.units : 0n, auth!.validUntil, auth!.signature] })}
          describeSimulation={(r) => `Listing #${String(r)}: ${props.name} for ${price} ${currency}. The NFT moves into the market contract.`}
          confirmLabel="Confirm and list"
          onDone={props.onDone}
          onCancel={() => setSigning(false)}
        />
      )}
    </li>
  );
}

function UnlistCard({ me, row, onDone }: { me: Address; row: Row; onDone: () => void }) {
  const [signing, setSigning] = useState(false);
  return (
    <li className="nftcard">
      {row.image && <img src={row.image} alt={`${row.name}, generative loops artwork`} width={160} height={160} />}
      <p className="nftcard__name">{row.name}</p>
      <p className="hint fig">
        Listed at {displayAmount(row.price, cur(row.currency).decimals)} {cur(row.currency).symbol}
      </p>
      {!signing ? (
        <button className="btn btn--quiet" type="button" onClick={() => setSigning(true)}>
          Cancel listing
        </button>
      ) : (
        <PqActionPanel
          sender={me}
          contract={MARKET}
          title={`Cancel listing #${row.id}`}
          summary={<p className="muted">{row.name} comes back to your wallet. Signed with your quantum-safe key.</p>}
          pq={{ actionName: "ACTION_CANCEL", paramsHash: enc(["uint256"], [row.id]) }}
          build={(auth) => ({ abi: qrowMarketAbi, functionName: "cancel", args: [row.id, auth!.validUntil, auth!.signature] })}
          describeSimulation={() => `${row.name} goes from the market back to you.`}
          confirmLabel="Confirm and cancel"
          onDone={onDone}
          onCancel={() => setSigning(false)}
        />
      )}
    </li>
  );
}
