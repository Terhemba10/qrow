import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TABS, isLive } from "../config/tabs";
import { Onboarding } from "../components/Shell";
import { useAccount } from "wagmi";
import { CHAIN } from "../config/network";
import { Button, Card, StatCard } from "../ds";
import { useBalances } from "../lib/portfolio";
import { useMarkets } from "../lib/predict";
import { PREDICT } from "../config/contracts";
import { useCandles, usePrices } from "../lib/trade";

/**
 * The 3D tab hub: every tab as a floating card that tilts toward the pointer or finger and opens on click/tap.
 * Pure CSS 3D transforms (no WebGL, no new dependency), so it runs on any phone. Flat grid, no motion, when the
 * visitor prefers reduced motion or the device looks low-end (≤ 2 GB memory or ≤ 2 cores), or on request.
 */
const ACCENTS = ["sky", "orange", "ink", "mint", "sky", "ink", "orange"] as const; // 7 long: no column stripes at 2, 3 or 4 columns
const EXTRA = [
  { id: "verify", path: "/verify", label: "Verify", blurb: "Check any transaction hash or Qrow reference against QoreChain testnet. No wallet needed." },
  { id: "help", path: "/help", label: "Help", blurb: "Get started in three steps: QoreX, free test QOR, then any tab." },
];

function useFlat(): [boolean, (v: boolean) => void] {
  const [flat, setFlat] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("qrow.hub.flat");
      if (saved) return saved === "1";
    } catch {
      /* storage blocked */
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lowEnd = (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2);
    return !!reduced || lowEnd;
  });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const on = (e: MediaQueryListEvent) => e.matches && setFlat(true);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  const set = (v: boolean) => {
    setFlat(v);
    try {
      localStorage.setItem("qrow.hub.flat", v ? "1" : "0");
    } catch {
      /* fine */
    }
  };
  return [flat, set];
}

function Tile({ i, path, label, blurb, soon, flat }: { i: number; path: string; label: string; blurb: string; soon: boolean; flat: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const nav = useNavigate();
  const frame = useRef(0);
  /** Tilt toward the pointer, at most once per animation frame (smooth on phones, no layout work). */
  const tilt = (e: PointerEvent<HTMLAnchorElement>) => {
    if (flat || !ref.current || frame.current) return;
    const { clientX, clientY } = e;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (clientX - r.left) / r.width - 0.5;
      const y = (clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--rx", `${(-y * 12).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(0)}%`);
      el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(0)}%`);
    });
  };
  const reset = () => {
    ref.current?.style.setProperty("--rx", "0deg");
    ref.current?.style.setProperty("--ry", "0deg");
  };
  return (
    <li className="hub__cell" style={{ "--i": i } as CSSProperties}>
      <Link
        ref={ref}
        to={path}
        className={`hubtile hubtile--${ACCENTS[i % ACCENTS.length]}`}
        onPointerMove={tilt}
        onPointerLeave={reset}
        onPointerUp={(e) => {
          // Touch: the first tap tilts, the release opens (a plain click also opens).
          if (e.pointerType === "touch") reset();
        }}
        onKeyDown={(e) => e.key === " " && (e.preventDefault(), nav(path))}
      >
        <span className="hubtile__face">
          <span className="hubtile__num fig" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="hubtile__label">{label}</span>
          <span className="hubtile__blurb">{blurb}</span>
          <span className="hubtile__go" aria-hidden="true">
            {soon ? "Coming soon" : "Enter →"}
          </span>
        </span>
        <span className="hubtile__glare" aria-hidden="true" />
      </Link>
    </li>
  );
}


/** The three live numbers above the tiles: your QOR, ETH on Trade, and the prediction markets. */
function HubStats() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const bal = useBalances(me);
  const prices = usePrices();
  const candles = useCandles("ETH/USDT");
  const markets = useMarkets();
  const qor = bal.data?.rows.find((r) => r.token.symbol === "QOR");
  const eth = prices.data?.prices["ETH/USDT"];
  const vol = (markets.data ?? []).reduce((s, m) => s + m.volume, 0n);
  const ethSpark = (candles.data ?? []).slice(-24).map((k) => k.c);
  return (
    <div className="hub__stats">
      {me ? (
        <StatCard tone="cyan" label="Your balance" value={qor ? Number(qor.evm / 10n ** 12n) / 1e6 : undefined} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })} unit="QOR" delta="Test QOR, no real value" />
      ) : (
        <Card tone="cyan" className="q-stat" as="div">
          <span className="q-stat__label">Your balance</span>
          <span className="q-stat__value">Connect</span>
          <span className="q-card__sub">QoreX shows your test QOR here.</span>
        </Card>
      )}
      <StatCard tone="orange" label="ETH on Trade" value={eth !== undefined ? Number(eth) / 1e8 : undefined} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} unit="USDT" spark={ethSpark.length > 1 ? ethSpark : undefined} delta="Live Binance price, last 24 hours" />
      <StatCard tone="mint" label="Prediction markets" value={markets.data ? markets.data.length : PREDICT ? undefined : 0} unit="open" delta={`${(Number(vol) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} fUSD traded`}>
        <Button to="/predict" variant="light" size="sm">
          See the markets
        </Button>
      </StatCard>
    </div>
  );
}

export function HubPage() {
  const [flat, setFlat] = useFlat();
  const tiles = [...TABS.map((t) => ({ ...t, soon: !isLive(t.id) })), ...EXTRA.map((t) => ({ ...t, soon: false }))];
  return (
    <section className={`page hub${flat ? " hub--flat" : ""}`} aria-labelledby="hub-title">
      <Onboarding />
      <div className="hub__head">
        <div>
          <p className="hub__kicker">QoreChain testnet · quantum-safe</p>
          <h1 id="hub-title" className="hub__title">
            Qrow hub
          </h1>
          <p className="muted">Every Qrow tab in one place. Try any feature with free test QOR: each transaction helps test QoreChain before Q-Day.</p>
        </div>
        <button className="btn btn--quiet" type="button" onClick={() => setFlat(!flat)} aria-pressed={flat}>
          {flat ? "3D view" : "Flat view"}
        </button>
      </div>
      <HubStats />
      <ul className="hub__grid" aria-label="All tabs">
        {tiles.map((t, i) => (
          <Tile key={t.id} i={i} path={t.path} label={t.label} blurb={t.blurb} soon={t.soon} flat={flat} />
        ))}
      </ul>
    </section>
  );
}
