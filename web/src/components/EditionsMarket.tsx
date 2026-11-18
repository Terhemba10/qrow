import { useState } from "react";
import { Button, EmptyState } from "../ds";
import { Link } from "react-router-dom";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { qrowEditionsAbi } from "../abi/QrowEditions";
import { EDITIONS } from "../config/contracts";
import { tokenBySymbol } from "../config/tokens";
import { short } from "../lib/address";
import { displayAmount } from "../lib/amount";
import { useEditionListings, type EditionListing } from "../lib/editions";
import { PqActionPanel } from "./PqActionPanel";

const FUSD = tokenBySymbol("fUSD")!;
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));

function BuyEdition({ me, l, onDone }: { me: Address; l: EditionListing; onDone: () => void }) {
  const [n, setN] = useState("1");
  const [signing, setSigning] = useState(false);
  const count = BigInt(/^\d+$/.test(n) ? n : "0");
  const total = count * l.price;
  const ok = count >= 1n && count <= l.amount;
  if (signing)
    return (
      <PqActionPanel
        sender={me}
        contract={EDITIONS!}
        title={`Buy ${count} × ${l.edition.name}`}
        summary={<p className="muted">The price goes straight to the seller; the copies come to you in the same transaction.</p>}
        approve={{ token: FUSD.address!, amount: total, label: "fUSD" }}
        pq={{ actionName: "ACTION_BUY", paramsHash: enc(["uint256", "uint256", "uint256", "uint256"], [l.id, l.editionId, count, l.price]) }}
        build={(auth) => ({ abi: qrowEditionsAbi, functionName: "buy", args: [l.id, count, auth!.validUntil, auth!.signature] })}
        confirmLabel="Buy in QoreX"
        details={[{ name: "Total", value: `${displayAmount(total, FUSD.decimals)} fUSD` }]}
        receipt={() => ({ kind: "NFT purchase", title: `Bought ${count} × ${l.edition.name}`, lines: [{ name: "Seller", value: l.seller }] })}
        onDone={() => {
          setSigning(false);
          onDone();
        }}
        onCancel={() => setSigning(false)}
      />
    );
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) setSigning(true);
      }}
    >
      <input className="input" style={{ width: 72 }} inputMode="numeric" aria-label="Copies to buy" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
      <button className="btn" type="submit" disabled={!ok}>
        Buy
      </button>
    </form>
  );
}

/** Listings of user-created NFTs (QrowEditions) on the NFT Market tab. */
export function EditionsMarket({ me }: { me?: Address }) {
  const q = useEditionListings();
  if (!EDITIONS) return null;
  return (
    <section className="stack" aria-labelledby="ed-market">
      <div className="section-head">
        <h2 id="ed-market">Community NFTs</h2>
        <Link className="btn btn--quiet" to="/create">
          Create your own
        </Link>
      </div>
      {q.isPending && <span className="skeleton" style={{ width: "100%", height: 160 }} />}
      {q.data?.length === 0 && <EmptyState title="No community NFTs for sale" text="Create your own and list it at your price." action={<Button to="/create">Create an NFT</Button>} />}
      <ul className="nftgrid">
        {(q.data ?? []).map((l) => (
          <li key={l.id.toString()} className="nftcard">
            {l.edition.image ? <img src={l.edition.image} alt={l.edition.name} width={160} height={160} loading="lazy" /> : <span className="skeleton" style={{ width: 160, height: 160 }} />}
            <p className="nftcard__name">{l.edition.name}</p>
            <p className="hint fig">
              {displayAmount(l.price, FUSD.decimals)} fUSD each · {l.amount.toString()} left
            </p>
            <p className="hint">
              Seller <span className="mono">{short(l.seller)}</span>
            </p>
            {me && me.toLowerCase() === l.seller.toLowerCase() ? (
              <Link className="btn btn--quiet" to={`/nft/edition/${l.editionId}`}>
                Manage
              </Link>
            ) : me ? (
              <BuyEdition me={me} l={l} onDone={() => void q.refetch()} />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
