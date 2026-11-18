import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { useAccount } from "wagmi";
import { qrowEditionsAbi } from "../abi/QrowEditions";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { BigAddress } from "../components/ConfirmSheet";
import { PqActionPanel } from "../components/PqActionPanel";
import { useConnectQorex } from "../components/QorexConnect";
import { EDITIONS, GENESIS, MARKET } from "../config/contracts";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { parseRecipient } from "../lib/address";
import { displayAmount, parseAmount } from "../lib/amount";
import { useEdition, useEditionListings, useHeldEditions } from "../lib/editions";
import { useNfts } from "../lib/portfolio";
import { ListCard, useMarket } from "./MarketPage";

const FUSD = tokenBySymbol("fUSD")!;
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));

/**
 * Send with the same safety as the Send tab: the recipient is shown with its first 4 and last 4 characters set
 * large, and the owner ticks that they match before anything is signed.
 */
function SendForm(props: { me: Address; max: bigint; withAmount: boolean; name: string; onSign: (to: Address, amount: bigint) => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [ack, setAck] = useState(false);
  const r = parseRecipient(to);
  const n = props.withAmount ? BigInt(/^\d+$/.test(amount) ? amount : "0") : 1n;
  const self = r.ok && r.evm.toLowerCase() === props.me.toLowerCase();
  const okAmount = n >= 1n && n <= props.max;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (r.ok && !self && ack && okAmount) props.onSign(r.evm, n);
      }}
    >
      <label className="field">
        <span>Send to (0x… or qor1…)</span>
        <input className="input input--mono" value={to} onChange={(e) => (setTo(e.target.value), setAck(false))} autoComplete="off" spellCheck={false} />
      </label>
      {to && !r.ok && <p className="field-error">That isn’t a valid QoreChain address.</p>}
      {self && <p className="field-error">That’s your own address.</p>}
      {props.withAmount && (
        <label className="field">
          <span>Copies (you have {props.max.toString()})</span>
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        </label>
      )}
      {r.ok && !self && (
        <div className="notice notice--warn stack">
          <p className="notice__title">Check the address. NFTs sent to the wrong address can’t be brought back.</p>
          <BigAddress address={r.evm} label="Recipient" />
          <label className="ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              The first 4 (<strong className="mono">{r.evm.slice(2, 6)}</strong>) and last 4 (<strong className="mono">{r.evm.slice(-4)}</strong>) characters match the address I was given.
            </span>
          </label>
        </div>
      )}
      <button className="btn" type="submit" disabled={!r.ok || self || !ack || !okAmount}>
        Review send
      </button>
    </form>
  );
}

function GenesisDetail({ me, id }: { me: Address; id: bigint }) {
  const nfts = useNfts(me);
  const market = useMarket();
  const n = nfts.data?.find((x) => x.id === id);
  const [mode, setMode] = useState<"send" | "list" | "delist">();
  const [send, setSend] = useState<Address>();
  const floorFor = (c: Address) => {
    const rows = (market.data?.rows ?? []).filter((r) => r.currency.toLowerCase() === c.toLowerCase());
    return rows.length ? rows.reduce((m, r) => (r.price < m ? r.price : m), rows[0].price) : undefined;
  };
  if (nfts.isPending) return <span className="skeleton" style={{ width: "100%", height: 240 }} />;
  if (!n) return <p className="notice">You don’t own Qrow Genesis #{id.toString()}. <Link to="/portfolio">Back to Portfolio</Link></p>;
  const refresh = () => {
    setMode(undefined);
    setSend(undefined);
    void nfts.refetch();
    void market.refetch();
  };
  return (
    <div className="split">
      <div className="panel stack">
        {n.image && <img className="nftpreview" src={n.image} alt={`${n.name}, generative loops artwork`} />}
        <p className="nftcard__name">{n.name}</p>
        {n.listed && (
          <p className="hint fig">
            Listed at {displayAmount(n.listed.price, n.listed.currency === ZERO ? 18 : FUSD.decimals)} {n.listed.currency === ZERO ? "QOR" : "fUSD"}
          </p>
        )}
      </div>
      <div className="panel stack">
        <div className="row">
          {!n.listed && (
            <button className="btn" type="button" onClick={() => setMode("send")} aria-pressed={mode === "send"}>
              Send
            </button>
          )}
          {!n.listed && (
            <button className="btn" type="button" onClick={() => setMode("list")} aria-pressed={mode === "list"}>
              List on NFT Market
            </button>
          )}
          {n.listed && (
            <button className="btn" type="button" onClick={() => setMode("delist")}>
              Delist (cancel listing)
            </button>
          )}
        </div>
        {mode === "send" && !send && <SendForm me={me} max={1n} withAmount={false} name={n.name} onSign={(to) => setSend(to)} />}
        {mode === "send" && send && (
          <PqActionPanel
            sender={me}
            contract={GENESIS}
            title={`Send ${n.name}`}
            summary={<BigAddress address={send} label="Recipient" />}
            pq={{ actionName: "ACTION_TRANSFER", paramsHash: enc(["address", "uint256"], [send, id]) }}
            build={(auth) => ({ abi: qrowGenesisAbi, functionName: "pqTransfer", args: [send, id, auth!.validUntil, auth!.signature] })}
            confirmLabel="Send in QoreX"
            details={[{ name: "To", value: send }]}
            receipt={() => ({ kind: "NFT sent", title: `Sent ${n.name}`, lines: [{ name: "To", value: send }] })}
            onDone={refresh}
            onCancel={() => setSend(undefined)}
          />
        )}
        {mode === "list" && (
          <ul className="nftgrid">
            <ListCard me={me} tokenId={id} name={n.name} image={n.image} floorFor={floorFor} onDone={refresh} />
          </ul>
        )}
        {mode === "delist" && n.listed && (
          <PqActionPanel
            sender={me}
            contract={MARKET}
            title={`Cancel listing #${n.listed.listingId}`}
            summary={<p className="muted">{n.name} comes back to your wallet.</p>}
            pq={{ actionName: "ACTION_CANCEL", paramsHash: enc(["uint256"], [n.listed.listingId]) }}
            build={(auth) => ({ abi: qrowMarketAbi, functionName: "cancel", args: [n.listed!.listingId, auth!.validUntil, auth!.signature] })}
            confirmLabel="Remove listing in QoreX"
            receipt={() => ({ kind: "NFT delisted", title: `Delisted ${n.name}`, lines: [] })}
            onDone={refresh}
            onCancel={() => setMode(undefined)}
          />
        )}
      </div>
    </div>
  );
}

function EditionDetail({ me, id }: { me: Address; id: bigint }) {
  const ed = useEdition(id);
  const held = useHeldEditions(me);
  const listings = useEditionListings();
  const mine = held.data?.find((h) => h.id === id);
  const myListings = (listings.data ?? []).filter((l) => l.editionId === id && l.seller.toLowerCase() === me.toLowerCase());
  const [mode, setMode] = useState<"send" | "list">();
  const [send, setSend] = useState<{ to: Address; n: bigint }>();
  const [amount, setAmount] = useState("1");
  const [price, setPrice] = useState("");
  const [listing, setListing] = useState(false);
  const [delist, setDelist] = useState<bigint>();
  const bal = mine?.balance ?? 0n;
  const listN = BigInt(/^\d+$/.test(amount) ? amount : "0");
  const p = parseAmount(price, FUSD.decimals);
  const refresh = () => {
    setMode(undefined);
    setSend(undefined);
    setListing(false);
    setDelist(undefined);
    void held.refetch();
    void listings.refetch();
  };
  const e = ed.data;
  if (ed.isPending) return <span className="skeleton" style={{ width: "100%", height: 240 }} />;
  if (!e) return <p className="notice">Edition not found.</p>;
  return (
    <div className="split">
      <div className="panel stack">
        {e.image ? <img className="nftpreview" src={e.image} alt={e.name} /> : <div className="nftpreview nftpreview--empty">{e.name}</div>}
        <p className="nftcard__name">{e.name}</p>
        <p className="hint">{e.description}</p>
        <p className="hint fig">
          You hold {bal.toString()} of {e.supply.toString()}
        </p>
      </div>
      <div className="panel stack">
        {bal > 0n && (
          <div className="row">
            <button className="btn" type="button" onClick={() => setMode("send")} aria-pressed={mode === "send"}>
              Send
            </button>
            <button className="btn" type="button" onClick={() => setMode("list")} aria-pressed={mode === "list"}>
              List on NFT Market
            </button>
          </div>
        )}
        {mode === "send" && !send && <SendForm me={me} max={bal} withAmount name={e.name} onSign={(to, n) => setSend({ to, n })} />}
        {mode === "send" && send && (
          <PqActionPanel
            sender={me}
            contract={EDITIONS!}
            title={`Send ${send.n} × ${e.name}`}
            summary={<BigAddress address={send.to} label="Recipient" />}
            pq={{ actionName: "ACTION_SEND", paramsHash: enc(["address", "uint256", "uint256"], [send.to, id, send.n]) }}
            build={(auth) => ({ abi: qrowEditionsAbi, functionName: "send", args: [send.to, id, send.n, auth!.validUntil, auth!.signature] })}
            confirmLabel="Send in QoreX"
            details={[
              { name: "To", value: send.to },
              { name: "Copies", value: send.n.toString() },
            ]}
            receipt={() => ({ kind: "NFT sent", title: `Sent ${send.n} × ${e.name}`, lines: [{ name: "To", value: send.to }] })}
            onDone={refresh}
            onCancel={() => setSend(undefined)}
          />
        )}
        {mode === "list" && !listing && (
          <form
            className="stack"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (p.ok && listN >= 1n && listN <= bal) setListing(true);
            }}
          >
            <div className="row">
              <label className="field">
                <span>Copies to list (max {bal.toString()})</span>
                <input className="input" inputMode="numeric" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/\D/g, ""))} />
              </label>
              <label className="field">
                <span>Price per copy (fUSD)</span>
                <input className="input" inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} placeholder="2.5" />
              </label>
            </div>
            <button className="btn" type="submit" disabled={!p.ok || listN < 1n || listN > bal}>
              Review listing
            </button>
          </form>
        )}
        {mode === "list" && listing && p.ok && (
          <PqActionPanel
            sender={me}
            contract={EDITIONS!}
            title={`List ${listN} × ${e.name}`}
            summary={<p className="muted">The copies wait in the contract until they sell or you delist them. Buyers pay you directly.</p>}
            pq={{ actionName: "ACTION_LIST", paramsHash: enc(["uint256", "uint256", "uint256"], [id, listN, p.units]) }}
            build={(auth) => ({ abi: qrowEditionsAbi, functionName: "list", args: [id, listN, p.units, auth!.validUntil, auth!.signature] })}
            confirmLabel="List in QoreX"
            details={[
              { name: "Copies", value: listN.toString() },
              { name: "Price per copy", value: `${price} fUSD` },
            ]}
            receipt={() => ({ kind: "NFT listing", title: `Listed ${listN} × ${e.name} at ${price} fUSD`, lines: [] })}
            onDone={refresh}
            onCancel={() => setListing(false)}
          />
        )}
        {myListings.length > 0 && (
          <div className="stack">
            <h3>Your listings</h3>
            {myListings.map((l) =>
              delist === l.id ? (
                <PqActionPanel
                  key={l.id.toString()}
                  sender={me}
                  contract={EDITIONS!}
                  title={`Delist #${l.id}`}
                  summary={<p className="muted">{l.amount.toString()} copies come back to your wallet.</p>}
                  pq={{ actionName: "ACTION_CANCEL", paramsHash: enc(["uint256"], [l.id]) }}
                  build={(auth) => ({ abi: qrowEditionsAbi, functionName: "cancel", args: [l.id, auth!.validUntil, auth!.signature] })}
                  confirmLabel="Delist in QoreX"
                  receipt={() => ({ kind: "NFT delisted", title: `Delisted ${e.name}`, lines: [] })}
                  onDone={refresh}
                  onCancel={() => setDelist(undefined)}
                />
              ) : (
                <p key={l.id.toString()} className="row">
                  <span className="fig">
                    {l.amount.toString()} × {displayAmount(l.price, FUSD.decimals)} fUSD
                  </span>
                  <button className="btn btn--quiet" type="button" onClick={() => setDelist(l.id)}>
                    Delist
                  </button>
                </p>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function NftDetailPage() {
  const { kind, id } = useParams();
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const tokenId = /^\d+$/.test(id ?? "") ? BigInt(id!) : undefined;
  return (
    <section className="page" aria-labelledby="nft-detail-title">
      <div className="sheet__head">
        <h1 id="nft-detail-title">{kind === "edition" ? "Your NFT" : `Qrow Genesis #${id}`}</h1>
        <p className="muted">
          Send it to another wallet, list it on the Qrow NFT Market at your own price, or delist it. Each action is approved in QoreX. <Link to="/portfolio">Back to Portfolio</Link>
        </p>
      </div>
      {!me ? (
        <button className="btn" type="button" onClick={connect}>
          Connect QoreX
        </button>
      ) : tokenId === undefined ? (
        <p className="notice">Unknown NFT.</p>
      ) : kind === "edition" ? (
        EDITIONS ? <EditionDetail me={me} id={tokenId} /> : <p className="notice">The editions contract isn’t deployed yet.</p>
      ) : (
        <GenesisDetail me={me} id={tokenId} />
      )}
    </section>
  );
}
