import { useConnectModal } from "@rainbow-me/rainbowkit";
import { evmToQor } from "@qorechain/sdk";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { AddressChip } from "../components/AddressChip";
import { IconCheck } from "../components/Icons";
import { CHAIN } from "../config/network";
import { TABS, isLive } from "../config/tabs";
import { displayAmount } from "../lib/amount";
import { CLAIM_INTERVAL_MS, FAUCET_COINS, FAUCET_URL, useBalanceWatcher, useLastFaucetClaim } from "../lib/faucet";

const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function hoursMinutes(ms: number) {
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/**
 * Faucet tab: gets new users their free test tokens from QoreChain's official faucet. Qrow links to it
 * (it needs the user's own Dashboard sign-in); it never embeds, proxies or automates a claim.
 */
export function FaucetPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const qor = me ? evmToQor(me) : undefined;
  const [copied, setCopied] = useState(false);
  const watch = useBalanceWatcher(qor);
  const last = useLastFaucetClaim(qor);
  const nextAt = last.data !== undefined ? last.data + CLAIM_INTERVAL_MS : undefined;
  const liveNext = TABS.filter((t) => isLive(t.id) && t.id !== "faucet");

  const copy = async () => {
    if (!qor) return;
    try {
      await navigator.clipboard.writeText(qor);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="page" aria-labelledby="faucet-title">
      <div className="sheet__head">
        <h1 id="faucet-title">Faucet</h1>
        <p className="muted">Free test tokens from QoreChain’s official faucet. Test tokens have no real value.</p>
      </div>

      <div className="split">
        <section className="panel stack" aria-labelledby="addr-title">
          <h2 id="addr-title">Your faucet address</h2>
          {qor ? (
            <>
              <p className="faucet-addr">
                <AddressChip address={qor} />
              </p>
              <div className="row">
                <button className="btn btn--quiet" type="button" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>
              <p className="hint">
                The faucet only accepts <span className="mono">qor1…</span> addresses. This is the same account as your <span className="mono">0x…</span> address, written the native way.
              </p>
            </>
          ) : (
            <>
              <p>Connect QoreX to see your address, so you can check it matches what the faucet uses.</p>
              <button className="btn btn--quiet" type="button" onClick={openConnectModal}>
                Connect QoreX
              </button>
            </>
          )}

          <a className="btn btn--block" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            Open QoreChain Faucet
          </a>

          <p className="hint">On the faucet: sign in with QoreX on Testnet, choose “Use my address”, then Request Tokens.</p>
        </section>

        <section className="stack" aria-labelledby="what-title">
          <h2 id="what-title">What a claim gives</h2>
          <ul className="facts-list">
            {FAUCET_COINS.map((c) => (
              <li key={c.symbol}>
                <span className="fig">{c.perClaim}</span> {c.symbol}
              </li>
            ))}
          </ul>
          <p className="hint">
            Amounts from QoreChain’s faucet documentation (as of 27 October); the faucet shows the exact amounts when it pays. One claim every 24 hours per account and per address. fUSD, fETH and fBTC arrive as native
            coins.
          </p>

          {qor && (
            <div className="stack" aria-live="polite">
              <h2>Your balance</h2>
              {watch.error && <p className="hint">Couldn’t read your balance just now. Qrow keeps trying while this page is open.</p>}
              {watch.now && (
                <ul className="facts-list">
                  {FAUCET_COINS.map((c) => (
                    <li key={c.symbol}>
                      <span className="fig">{displayAmount(watch.now![c.denom] ?? 0n, c.decimals)}</span> {c.symbol}
                    </li>
                  ))}
                </ul>
              )}
              {watch.arrived.length > 0 ? (
                <div className="notice notice--ok" role="status">
                  <p className="notice__title">
                    <IconCheck /> Tokens received
                  </p>
                  <p className="fig">{watch.arrived.map((a) => `${displayAmount(a.units, a.decimals)} ${a.symbol}`).join(", ")}</p>
                  <p>
                    Next: swap some QOR for fUSD, send a payment, or buy an NFT as those tabs open.
                    {liveNext.length > 0 && " Already open:"}{" "}
                    {liveNext.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ", "}
                        <Link to={t.path}>{t.label}</Link>
                      </span>
                    ))}
                    .
                  </p>
                </div>
              ) : (
                watch.now && <p className="hint">Watching for your tokens while this page is open (checked every 15 seconds).</p>
              )}
              {nextAt !== undefined &&
                (nextAt > Date.now() ? (
                  <p className="hint">
                    Your last faucet payment we can see was {when.format(new Date(last.data!))}, so your next claim is about {hoursMinutes(nextAt - Date.now())} away.
                  </p>
                ) : (
                  <p className="hint">Your last faucet payment we can see was {when.format(new Date(last.data!))}: you can claim again.</p>
                ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
