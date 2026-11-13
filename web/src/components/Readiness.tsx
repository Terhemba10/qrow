import { useConnectModal } from "@rainbow-me/rainbowkit";
import { evmToQor } from "@qorechain/sdk";
import { useState } from "react";
import type { Address } from "viem";
import { displayAmount } from "../lib/amount";
import { MIN_QOR, useReadiness, type Item, type ItemId } from "../lib/readiness";
import { DeviceSetup } from "./DeviceSetup";
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
  connected: "QoreX is connected to Qrow",
  network: "On QoreChain testnet",
  sameAccount: "Qrow and QoreX show the same account",
  qor: "You have free test QOR for fees",
  chainKey: "Your quantum-safe key is registered",
  device: "This device is set up",
};

/** The "Ready to test?" card: every item with its status and the fix. */
export function Readiness({ compact = false }: { compact?: boolean }) {
  const { items, ready, me, qorexQor, balance, refetch, device } = useReadiness();
  const { openConnectModal } = useConnectModal();
  const [open, setOpen] = useState<ItemId>();
  const done = items.filter((i) => i.state === "ok").length;

  if (compact && ready) return null;

  const fix = (i: Item) => {
    switch (i.id) {
      case "qorex":
        return (
          <p>
            Every Qrow transaction is signed in QoreX. On a computer, add the QoreX extension to Chrome or Firefox. On a phone, open Qrow inside the QoreX app’s dApp Browser (Home, then “Enter a dApp URL”).{" "}
            <a href={QOREX_URL} target="_blank" rel="noopener noreferrer">
              Get QoreX
            </a>
          </p>
        );
      case "connected":
        return (
          <>
            <p>Connect QoreX so Qrow can read your balances. Connecting never moves anything.</p>
            <button className="btn" type="button" onClick={openConnectModal}>
              Connect QoreX
            </button>
          </>
        );
      case "network":
        return <p>Switch QoreX to the testnet: Settings, then “Use testnet (developers)”. Qrow never switches it for you.</p>;
      case "sameAccount":
        return (
          <p>
            {qorexQor ? (
              <>
                QoreX is on <AddressChip address={qorexQor} />, but Qrow is reading <AddressChip address={me ? evmToQor(me) : ""} />.{" "}
              </>
            ) : (
              "QoreX hasn’t shared an account with Qrow yet. "
            )}
            Choose the same account in QoreX, then reconnect.
          </p>
        );
      case "qor":
        return (
          <>
            <p>
              You have {balance !== undefined ? displayAmount(balance, 18) : "…"} QOR. About {displayAmount(MIN_QOR, 18)} QOR covers several actions. The faucet is free, once every 24 hours, and also gives fUSD to pay with. Qrow
              re-checks when you come back to this tab.
            </p>
            <a className="btn" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
              Get free test tokens
            </a>
          </>
        );
      case "chainKey":
        return <p>QoreX registers your quantum-safe key with your first transfer. In QoreX, send yourself a tiny amount (0.01 QOR), then come back here.</p>;
      case "device":
        return me ? <DeviceSetup account={me as Address} state={device} onDone={refetch} /> : null;
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
