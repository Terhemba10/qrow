import { useConnectModal } from "@rainbow-me/rainbowkit";
import { getLogsChunked } from "../lib/logs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeAbiParameters, keccak256, parseAbiItem, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { PqActionPanel } from "../components/PqActionPanel";
import { GENESIS, GENESIS_DEPLOY_BLOCK } from "../config/contracts";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { displayAmount } from "../lib/amount";
import { parseTokenUri } from "../lib/portfolio";
import { short } from "../lib/address";

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const minted = parseAbiItem("event Minted(uint256 indexed tokenId, address indexed to, address currency, uint256 price)");

function useCollection() {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["genesis-collection"],
    enabled: !!client,
    refetchInterval: 20_000,
    queryFn: async () => {
      const c = client!;
      const [total, max, perWallet, priceQor, priceFusd, fusd] = await Promise.all([
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "totalMinted" }),
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "MAX_SUPPLY" }),
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "MAX_PER_WALLET" }),
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "priceQor" }),
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "priceFusd" }),
        c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "fusd" }),
      ]);
      const logs = await getLogsChunked(GENESIS_DEPLOY_BLOCK, await c.getBlockNumber(), (fromBlock, toBlock) => c.getLogs({ address: GENESIS, event: minted, fromBlock, toBlock }));
      const recent = await Promise.all(
        logs
          .slice(-12)
          .reverse()
          .map(async (l) => ({ id: l.args.tokenId!, to: l.args.to!, ...parseTokenUri(await c.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "tokenURI", args: [l.args.tokenId!] })) })),
      );
      return { total, max, perWallet, priceQor, priceFusd, fusd, recent };
    },
  });
}

export function ShopPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const client = usePublicClient({ chainId: CHAIN.id });
  const col = useCollection();
  const [currency, setCurrency] = useState<"QOR" | "fUSD">("fUSD");
  const [minting, setMinting] = useState(false);
  const [mintedId, setMintedId] = useState<bigint>();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const myMints = useQuery({
    queryKey: ["mintedBy", me],
    enabled: !!me && !!client,
    queryFn: () => client!.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "mintedBy", args: [me!] }),
  });

  const d = col.data;
  const soldOut = d ? d.total >= d.max : false;
  const atLimit = d && myMints.data !== undefined ? myMints.data >= d.perWallet : false;
  const price = d ? (currency === "QOR" ? d.priceQor : d.priceFusd) : 0n;
  const currencyAddr: Address = d ? (currency === "QOR" ? ZERO : d.fusd) : ZERO;
  const decimals = currency === "QOR" ? 18 : tokenBySymbol("fUSD")!.decimals;

  return (
    <section className="page" aria-labelledby="shop-title">
      <div className="sheet__head">
        <h1 id="shop-title">NFT Shop</h1>
        <p className="muted">Qrow Genesis: 256 pieces of original generative art, drawn on chain. Each one moves only with its owner’s quantum-safe signature. Testnet NFTs with no value.</p>
      </div>

      <div className="split">
        <section className="stack" aria-labelledby="recent-title">
          <div className="section-head">
            <h2 id="recent-title">Recently minted</h2>
            {d && (
              <p className="hint fig">
                {d.total.toString()} of {d.max.toString()} minted
              </p>
            )}
          </div>
          {col.isPending && <span className="skeleton" style={{ width: "100%", height: 180 }} />}
          {col.isError && <p className="field-error">Couldn’t load the collection from the testnet.</p>}
          {d && d.recent.length === 0 && <p className="muted">Nothing minted yet. Yours could be #1.</p>}
          {d && d.recent.length > 0 && (
            <ul className="nftgrid">
              {d.recent.map((n) => (
                <li key={n.id.toString()} className="nftcard">
                  {n.image && <img src={n.image} alt={`${n.name}, generative loops artwork`} width={160} height={160} />}
                  <p className="nftcard__name">{n.name}</p>
                  <p className="hint">
                    Owner <span className="mono">{short(n.to)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel stack" aria-labelledby="mint-title">
          <h2 id="mint-title">Mint one</h2>
          {d && (
            <dl className="facts">
              <div>
                <dt>Price</dt>
                <dd className="fig">
                  {displayAmount(d.priceQor, 18)} QOR or {displayAmount(d.priceFusd, tokenBySymbol("fUSD")!.decimals)} fUSD
                </dd>
              </div>
              <div>
                <dt>Limit</dt>
                <dd>{d.perWallet.toString()} per wallet{me && myMints.data !== undefined ? `, you have minted ${myMints.data}` : ""}</dd>
              </div>
              <div>
                <dt>Paid to</dt>
                <dd>The collection’s fixed beneficiary, in the same transaction. The contract never holds funds.</dd>
              </div>
            </dl>
          )}
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Pay with</legend>
            <div className="seg">
              {(["QOR", "fUSD"] as const).map((c) => (
                <span key={c}>
                  <input type="radio" name="mint-cur" id={`mint-${c}`} checked={currency === c} onChange={() => setCurrency(c)} />
                  <label htmlFor={`mint-${c}`}>{c}</label>
                </span>
              ))}
            </div>
          </fieldset>
          {!me ? (
            <button className="btn" type="button" onClick={openConnectModal}>
              Connect QoreX to mint
            </button>
          ) : soldOut ? (
            <p className="muted">Sold out: all 256 are minted. Look in the NFT Market.</p>
          ) : atLimit ? (
            <p className="muted">You’ve reached the limit of {d?.perWallet.toString()} per wallet.</p>
          ) : !minting ? (
            <button className="btn btn--block" type="button" disabled={!d} onClick={() => setMinting(true)}>
              Mint for {d ? `${displayAmount(price, decimals)} ${currency}` : "…"}
            </button>
          ) : (
            <PqActionPanel
              sender={me}
              contract={GENESIS}
              title="Mint a Qrow Genesis NFT"
              summary={
                <p className="muted">
                  You pay {displayAmount(price, decimals)} {currency} and receive the next token. Signed with your quantum-safe key.
                </p>
              }
              pq={{ actionName: "ACTION_MINT", paramsHash: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyAddr, price])) }}
              approve={currency === "fUSD" && d ? { token: d.fusd, amount: price, label: `${displayAmount(price, decimals)} fUSD` } : undefined}
              build={(auth) => ({ abi: qrowGenesisAbi, functionName: "mint", args: [currencyAddr, auth!.validUntil, auth!.signature], value: currency === "QOR" ? price : 0n })}
              describeSimulation={(r) => `You receive Qrow Genesis #${String(r)} and pay ${displayAmount(price, decimals)} ${currency}.`}
              confirmLabel="Mint in QoreX"
              onDone={async () => {
                setMintedId(await client!.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "totalMinted" }));
                void col.refetch();
                void myMints.refetch();
              }}
              onCancel={() => setMinting(false)}
            />
          )}
          {mintedId !== undefined && <p className="notice notice--ok">You minted Qrow Genesis #{mintedId.toString()}. It’s in your Portfolio.</p>}
        </section>
      </div>
    </section>
  );
}
