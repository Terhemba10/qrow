import { useConnectQorex } from "../components/QorexConnect";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { encodeAbiParameters, keccak256, toBytes, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowCoinAbi } from "../abi/QrowCoin";
import { qrowCoinFactoryAbi } from "../abi/QrowCoinFactory";
import { launchChecks, type LaunchCheck } from "../agent/launchChecks";
import { IconAlert, IconCheck, IconInfo, IconStop } from "../components/Icons";
import { PqActionPanel } from "../components/PqActionPanel";
import { COIN_FACTORY } from "../config/contracts";
import { CHAIN } from "../config/network";
import { short } from "../lib/address";
import { displayAmount } from "../lib/amount";
import { useCoins, type LaunchedCoin } from "../lib/coins";

const ICON = { block: IconStop, danger: IconStop, warn: IconAlert, info: IconInfo, ok: IconCheck } as const;
const ORDER = ["block", "danger", "warn", "info", "ok"];
const h = (s: string) => keccak256(toBytes(s));
const whole = (n: bigint) => displayAmount(n, 18);
const pctLeft = (c: LaunchedCoin) => (c.publicPool === 0n ? 0 : Number((c.remainingPublic * 1000n) / c.publicPool) / 10);
const fmtDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function LaunchPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect: openConnectModal } = useConnectQorex();
  const client = usePublicClient({ chainId: CHAIN.id });
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const coins = useCoins(me);
  const ids = { name: useId(), symbol: useId(), supply: useId(), pct: useId(), desc: useId() };

  const [form, setForm] = useState({ name: "", symbol: "", supply: "1000000", creatorPct: "0", description: "" });
  const [ack, setAck] = useState(false);
  const [signing, setSigning] = useState(false);
  const [launched, setLaunched] = useState<{ coin: Address; symbol: string }>();
  const [claiming, setClaiming] = useState<LaunchedCoin>();
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setAck(false);
    setSigning(false);
  };

  const touched = form.name !== "" || form.symbol !== "";
  const local = useMemo(() => launchChecks(form, coins.data ?? []), [form, coins.data]);
  const formatOk = !local.some((c) => (c.id === "name" || c.id === "symbol") && c.level === "block");
  // The factory's own rule check, read from chain (pure view, free).
  const onChain = useQuery({
    queryKey: ["checkNames", form.name, form.symbol],
    enabled: !!client && touched && formatOk,
    staleTime: Infinity,
    queryFn: () => client!.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "checkNames", args: [form.name, form.symbol] }),
  });
  const checks: LaunchCheck[] = [...local];
  if (onChain.data) {
    const [ok, reason] = onChain.data;
    checks.push(ok ? { id: "chain", level: "ok", title: "The factory’s on-chain rules accept it" } : { id: "chain", level: "block", title: "The factory would refuse this", detail: `On-chain rule: ${reason}.` });
  } else if (onChain.isError) {
    checks.push({ id: "chain", level: "warn", title: "Couldn’t ask the factory", detail: "The launch is simulated before you sign, so a refusal still shows up then." });
  }
  checks.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  const blocked = checks.some((c) => c.level === "block");
  const warned = checks.some((c) => c.level === "warn");
  const ready = touched && !blocked && (!formatOk || onChain.isSuccess || onChain.isError) && (!warned || ack);

  const supply = /^\d{1,13}$/.test(form.supply) ? BigInt(form.supply) : 0n;
  const bps = Math.round(Number(form.creatorPct) * 100);
  const paramsHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint16" }, { type: "bytes32" }],
      [h(form.name), h(form.symbol), supply, bps, h(form.description)],
    ),
  );

  return (
    <section className="page" aria-labelledby="launch-title">
      <div className="sheet__head">
        <h1 id="launch-title">Launch a coin</h1>
        <p className="notice notice--warn" role="note">
          Testnet memecoin: no real value. Never buy coins expecting profit.
        </p>
      </div>

      <div className="split">
        <section className="stack" aria-labelledby="coins-title">
          <div className="section-head">
            <h2 id="coins-title">Launched coins</h2>
            {coins.data && <p className="hint fig">{coins.data.length} launched</p>}
          </div>
          {coins.isPending && <span className="skeleton" style={{ width: "100%", height: 160 }} />}
          {coins.isError && <p className="field-error">Couldn’t read the launched coins from the testnet.</p>}
          {coins.data && coins.data.length === 0 && <p className="muted">No coins yet. The first one could be yours.</p>}
          {coins.data && coins.data.length > 0 && (
            <ul className="coinlist">
              {coins.data.map((c) => (
                <li key={c.address} className="coin">
                  <div className="coin__head">
                    <p className="coin__name">
                      {c.name} <span className="fig">{c.symbol}</span>
                    </p>
                    <p className="hint">{fmtDate.format(new Date(c.launchedAt * 1000))}</p>
                  </div>
                  <ul className="badges" aria-label="Safety facts, read from chain">
                    <li className="badge badge--safe">Fixed supply</li>
                    <li className="badge badge--safe">No owner powers</li>
                    <li className={`badge${c.creatorBps > 500 ? " badge--warn" : " badge--safe"}`}>Creator {c.creatorBps / 100}%</li>
                    <li className="badge">Public pool {pctLeft(c)}% left</li>
                    {c.symbolShared > 1 && <li className="badge badge--warn">{c.symbolShared} coins use {c.symbol}</li>}
                  </ul>
                  {c.description && (
                    <p className="coin__desc">
                      <span className="hint">Creator’s words, unchecked: </span>
                      {c.description}
                    </p>
                  )}
                  <dl className="facts">
                    <div>
                      <dt>Supply</dt>
                      <dd className="fig">{whole(c.totalSupply)}</dd>
                    </div>
                    <div>
                      <dt>Contract</dt>
                      <dd className="mono">{c.address}</dd>
                    </div>
                    <div>
                      <dt>Creator</dt>
                      <dd className="mono" title={c.creator}>
                        {short(c.creator)}
                        {me && c.creator.toLowerCase() === me.toLowerCase() ? " (you)" : ""}
                      </dd>
                    </div>
                    {c.mine && (
                      <div>
                        <dt>You hold</dt>
                        <dd className="fig">
                          {whole(c.mine.balance)} {c.symbol}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {me && c.mine && !c.mine.claimed && c.remainingPublic > 0n && claiming?.address !== c.address && (
                    <button className="btn btn--quiet" type="button" onClick={() => setClaiming(c)}>
                      Claim {whole(c.remainingPublic < c.claimAmount ? c.remainingPublic : c.claimAmount)} {c.symbol} (free, once)
                    </button>
                  )}
                  {c.mine?.claimed && <p className="hint">You’ve claimed your share. Send it from the Send tab.</p>}
                  {me && claiming?.address === c.address && (
                    <PqActionPanel
                      sender={me}
                      contract={c.address}
                      title={`Claim ${c.symbol}`}
                      summary={<p className="muted">One share of the public pool, once per account. Signed with your quantum-safe key. It has no value.</p>}
                      pq={{ actionName: "ACTION_CLAIM", paramsHash: keccak256(encodeAbiParameters([{ type: "address" }], [c.address])) }}
                      build={(auth) => ({ abi: qrowCoinAbi, functionName: "claim", args: [auth!.validUntil, auth!.signature] })}
                      describeSimulation={(r) => `You receive ${whole(r as bigint)} ${c.symbol}.`}
                      confirmLabel="Claim in QoreX"
                      onDone={() => void coins.refetch()}
                      onCancel={() => setClaiming(undefined)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel stack" aria-labelledby="new-title">
          <h2 id="new-title">New coin</h2>
          <p className="hint">Rules no one can change: fixed supply, no owner, no fees, no blacklist. You can keep up to 10%; the rest is claimable by anyone with a quantum-safe key.</p>
          <div className="field">
            <label htmlFor={ids.name}>Name</label>
            <input id={ids.name} className="input" maxLength={32} autoComplete="off" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Paper Lantern" />
          </div>
          <div className="field">
            <label htmlFor={ids.symbol}>Symbol</label>
            <input id={ids.symbol} className="input input--mono" maxLength={8} autoComplete="off" spellCheck={false} value={form.symbol} onChange={(e) => set("symbol")(e.target.value.toUpperCase())} placeholder="LANT" />
          </div>
          <div className="field">
            <label htmlFor={ids.supply}>Total supply (whole coins)</label>
            <input id={ids.supply} className="input fig" inputMode="numeric" value={form.supply} onChange={(e) => set("supply")(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div className="field">
            <label htmlFor={ids.pct}>Your share (%)</label>
            <input id={ids.pct} className="input fig" inputMode="decimal" value={form.creatorPct} onChange={(e) => set("creatorPct")(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.desc}>Description (optional)</label>
            <textarea id={ids.desc} className="input" rows={3} maxLength={280} value={form.description} onChange={(e) => set("description")(e.target.value)} />
          </div>

          {touched && (
            <section className="checks" aria-labelledby="lc-title" aria-live="polite">
              <h3 id="lc-title">Checks</h3>
              <ul className="checks__list">
                {checks.map((c) => {
                  const Icon = ICON[c.level];
                  return (
                    <li key={c.id} className={`check check--${c.level}`}>
                      <span className="check__icon">
                        <Icon />
                      </span>
                      <div className="check__body">
                        <p className="check__title">{c.title}</p>
                        {c.detail && <p className="check__detail">{c.detail}</p>}
                      </div>
                    </li>
                  );
                })}
                {onChain.isFetching && <li className="check hint">Asking the factory…</li>}
              </ul>
            </section>
          )}
          {warned && !blocked && (
            <label className="ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I’ve read the warnings and want to launch anyway.</span>
            </label>
          )}

          {!me ? (
            <button className="btn" type="button" onClick={openConnectModal}>
              Connect QoreX to launch
            </button>
          ) : !signing ? (
            <button className="btn btn--block" type="button" disabled={!ready} onClick={() => setSigning(true)}>
              Launch {form.symbol || "coin"}
            </button>
          ) : (
            <PqActionPanel
              sender={me}
              contract={COIN_FACTORY}
              title={`Launch ${form.symbol}`}
              summary={
                <p className="muted">
                  {form.name} ({form.symbol}): {Number(supply).toLocaleString()} coins, {form.creatorPct}% to you, the rest claimable by the public. Signed with your quantum-safe key.
                </p>
              }
              pq={{ actionName: "ACTION_LAUNCH", paramsHash }}
              build={(auth) => ({ abi: qrowCoinFactoryAbi, functionName: "launch", args: [form.name, form.symbol, supply, bps, form.description, auth!.validUntil, auth!.signature] })}
              describeSimulation={(r) => `The factory creates ${form.symbol} at ${String(r)}.`}
              confirmLabel="Launch in QoreX"
              onDone={async () => {
                const n = await client!.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "coinCount" });
                const [coin] = await client!.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "coins", args: [n - 1n, 1n] });
                if (coin) setLaunched({ coin, symbol: form.symbol });
                setForm({ name: "", symbol: "", supply: "1000000", creatorPct: "0", description: "" });
                void coins.refetch();
              }}
              onCancel={() => setSigning(false)}
            />
          )}
          {launched && (
            <p className="notice notice--ok" role="status">
              {launched.symbol} is live at <span className="mono">{launched.coin}</span>. It now appears in Send and your Portfolio.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
