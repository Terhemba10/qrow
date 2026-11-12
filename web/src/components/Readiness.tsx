import { useConnectModal } from "@rainbow-me/rainbowkit";
import { evmToQor } from "@qorechain/sdk";
import { useState } from "react";
import type { Address } from "viem";
import { displayAmount } from "../lib/amount";
import { MIN_QOR, useReadiness, type Item, type ItemId } from "../lib/readiness";
import { AppKeySetup } from "./AppKeySetup";
import { IconAlert, IconCheck, IconInfo } from "./Icons";

export const QOREX_URL = "https://qorechain.io/qorex";
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";

/** An address with its first and last 4 characters highlighted (what people actually compare). */
export function AddressChip({ address }: { address: string }) {
  const p = address.startsWith("0x") ? 2 : address.indexOf("1") + 1;
  return (
    <span className="mono addr" title={address}>
      {address.slice(0, p)}
      <mark>{address.slice(p, p + 4)}</mark>
      {address.slice(p + 4, -4)}
      <mark>{address.slice(-4)}</mark>
    </span>
  );
}

const TITLE: Record<ItemId, string> = {
  qorex: "QoreX is installed",
  evmWallet: "An EVM wallet (MetaMask) is connected",
  network: "On QoreChain testnet",
  sameAccount: "QoreX and MetaMask use the same account",
  qor: "You have test QOR for fees",
  chainKey: "Your quantum-safe key is registered",
  appKey: "Your Qrow key is set up",
};

/** The "Ready to test?" card: every item with its status and the fix. */
export function Readiness({ compact = false }: { compact?: boolean }) {
  const { items, ready, me, qorexQor, balance, refetch } = useReadiness();
  const { openConnectModal } = useConnectModal();
  const [open, setOpen] = useState<ItemId>();
  const done = items.filter((i) => i.state === "ok").length;

  if (compact && ready) return null;

  const fix = (i: Item) => {
    switch (i.id) {
      case "qorex":
        return (
          <p>
            QoreX opens the short EVM windows that keep you safe and signs your staking. On a computer, add the extension to Chrome or Firefox. On a phone, open Qrow inside the QoreX app’s dApp Browser.{" "}
            <a href={QOREX_URL} target="_blank" rel="noopener noreferrer">
              Get QoreX
            </a>
          </p>
        );
      case "evmWallet":
        return (
          <>
            <p>QoreX doesn’t send EVM transactions yet, so payments are signed in MetaMask (QoreChain’s own setup). Use a fresh testnet-only wallet that QoreX also holds.</p>
            <button className="btn" type="button" onClick={openConnectModal}>
              Connect wallet
            </button>
          </>
        );
      case "network":
        return <p>Switch your EVM wallet to QoreChain testnet (chain 9800). Qrow never switches it for you. In QoreX: Settings, then “Use testnet (developers)”.</p>;
      case "sameAccount":
        return (
          <p>
            {qorexQor ? (
              <>
                QoreX is on <AddressChip address={qorexQor} />, but MetaMask is on <AddressChip address={me ? evmToQor(me) : ""} />.{" "}
              </>
            ) : (
              "QoreX hasn’t shared an account with Qrow yet. "
            )}
            Both wallets must hold the same account: create it in MetaMask, then restore that recovery phrase into QoreX (testnet-only wallet).
          </p>
        );
      case "qor":
        return (
          <>
            <p>
              You have {balance !== undefined ? displayAmount(balance, 18) : "…"} QOR; about {displayAmount(MIN_QOR, 18)} QOR covers several actions. The faucet is free, once per 24 hours. Qrow re-checks
              when you come back to this tab.
            </p>
            <a className="btn" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
              Get test tokens
            </a>
          </>
        );
      case "chainKey":
        return <p>QoreX registers your quantum-safe key with your first transfer. In QoreX, send yourself a tiny amount (0.01 QOR), then come back here.</p>;
      case "appKey":
        return me ? <AppKeySetup account={me as Address} onDone={refetch} /> : null;
    }
  };

  return (
    <section className="panel stack" aria-labelledby="ready-title">
      <div className="section-head">
        <h2 id="ready-title">{ready ? "You’re ready to test Qrow" : "Ready to test?"}</h2>
        <p className="hint fig">
          {done} of {items.length} ready
        </p>
      </div>
      {me && (
        <p className="hint">
          Connected as <AddressChip address={me} />
        </p>
      )}
      <ul className="checks__list">
        {items.map((i) => {
          const isOpen = open === i.id || (open === undefined && i.state === "todo" && items.find((x) => x.state === "todo")?.id === i.id);
          return (
            <li key={i.id} className={`check check--${i.state === "ok" ? "ok" : i.state === "todo" ? "warn" : "info"}`}>
              <span className="check__icon">{i.state === "ok" ? <IconCheck /> : i.state === "todo" ? <IconAlert /> : <IconInfo />}</span>
              <div className="check__body">
                <p className="check__title">
                  {i.state === "todo" ? (
                    <button className="linkish" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? (undefined as never) : i.id)}>
                      {TITLE[i.id]}
                    </button>
                  ) : (
                    TITLE[i.id]
                  )}
                  {i.state === "wait" && <span className="hint"> (after the step above)</span>}
                  {i.state === "unknown" && <span className="hint"> (checking…)</span>}
                </p>
                {i.state === "todo" && isOpen && <div className="check__detail">{fix(i)}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
