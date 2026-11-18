/**
 * Mobile-first shell (UX-AUDIT #3): a bottom nav on phones (Hub, Trade, Predict, NFTs, More) with a "More" sheet
 * listing every tab, and the first-visit onboarding strip (Install QoreX, get free test QOR, try a tab).
 */
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { TABS } from "../config/tabs";
import { qorexDownload, useQorexInstalled } from "../lib/qorex";

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  hub: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  trade: "M4 17l5-5 4 4 7-8M15 8h5v5",
  predict: "M12 3v18M5 8h14M7 14h10",
  nfts: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 14l3-3 5 5M15 9h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function BottomNav() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>("a")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  const main = ["/", "/trade", "/predict", "/market"];
  const moreActive = !main.includes(loc.pathname) && !loc.pathname.startsWith("/nft/");
  return (
    <>
      <nav className="q-bottomnav" aria-label="Main">
        <NavLink to="/" end>
          <Icon d={ICONS.hub} />
          Hub
        </NavLink>
        <NavLink to="/trade">
          <Icon d={ICONS.trade} />
          Trade
        </NavLink>
        <NavLink to="/predict">
          <Icon d={ICONS.predict} />
          Predict
        </NavLink>
        <NavLink to="/market">
          <Icon d={ICONS.nfts} />
          NFTs
        </NavLink>
        <button type="button" aria-expanded={open} aria-controls="q-more" className={moreActive ? "active" : undefined} onClick={() => setOpen((o) => !o)}>
          <Icon d={ICONS.more} />
          More
        </button>
      </nav>
      {open && (
        <div className="q-more-backdrop" onClick={() => setOpen(false)}>
          <div id="q-more" className="q-more" ref={sheet} role="dialog" aria-modal="true" aria-label="All tabs" onClick={(e) => e.stopPropagation()}>
            <ul>
              {TABS.map((t) => (
                <li key={t.id}>
                  <NavLink to={t.path}>{t.label}</NavLink>
                </li>
              ))}
              <li>
                <NavLink to="/verify">Verify</NavLink>
              </li>
              <li>
                <NavLink to="/help">Help</NavLink>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

const KEY = "qrow.onboarding.v2";
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return false;
  }
};

/** First visit: three steps, each marked done as it happens. Browse freely; QoreX is only needed to sign. */
export function Onboarding() {
  const installed = useQorexInstalled();
  const { isConnected } = useAccount();
  const [hidden, setHidden] = useState(dismissed);
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* closes for this visit */
    }
    setHidden(true);
  };
  const dl = qorexDownload();
  const steps = [
    { done: installed, title: "Install QoreX", text: installed ? "QoreX found" : dl.phone ? "The QoreX app" : "The browser extension", link: installed ? undefined : { href: dl.url, label: dl.phone ? "Get the app" : "Add QoreX" } },
    { done: false, title: "Get free test QOR", text: "From the official faucet", link: { to: "/faucet", label: "Open the faucet" } },
    { done: isConnected, title: "Try a tab", text: "Swap, trade, predict or mint", link: { to: "/trade", label: "Start trading" } },
  ];
  return (
    <aside className="q-onboard" aria-label="Get started">
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "is-done" : undefined}>
            <span className="q-onboard__n" aria-hidden="true">
              {s.done ? "✓" : i + 1}
            </span>
            <span>
              <strong>{s.title}</strong>
              <span className="q-muted"> {s.text}</span>
              {s.done ? <span className="visually-hidden"> (done)</span> : null}
              {s.link && !s.done && (
                <>
                  {" "}
                  {"href" in s.link ? (
                    <a href={s.link.href} target="_blank" rel="noopener noreferrer">
                      {s.link.label}
                    </a>
                  ) : (
                    <Link to={s.link.to!}>{s.link.label}</Link>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      <button className="q-btn q-btn--quiet q-btn--sm" type="button" onClick={close}>
        Hide
      </button>
    </aside>
  );
}
