/**
 * Qrow design system v2: small shared components. Styles in src/styles/ds.css (classes q-*).
 * Button, Pill, NetworkBadge, Card, StatCard (+ Sparkline, count-up), TokenAmount, AddressChip, Skeleton, EmptyState.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
export type Tone = "brand" | "cyan" | "orange" | "mint" | "light";

// ------------------------------------------------------------------ Button
type ButtonVariant = Tone | "ghost" | "quiet";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  block?: boolean;
  loading?: boolean;
  /** Render as a router link instead of a button. */
  to?: string;
}
/** Pill button, 48px (sm: 44px) tall. Primary = Qrow violet. `loading` keeps the label and adds a spinner. */
export function Button({ variant = "brand", size = "md", block, loading, to, className, children, disabled, ...rest }: ButtonProps) {
  const cls = cx("q-btn", variant !== "brand" && `q-btn--${variant}`, size === "sm" && "q-btn--sm", block && "q-btn--block", className);
  if (to)
    return (
      <Link className={cls} to={to}>
        {children}
      </Link>
    );
  return (
    <button className={cls} type="button" disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="q-btn__spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Pill + NetworkBadge
export function Pill({ tone, dot, children }: { tone?: Tone | "danger"; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx("q-pill", tone && `q-pill--${tone}`)}>
      {dot && <span className="q-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Always visible in the top bar: Qrow runs on QoreChain testnet only. */
export function NetworkBadge() {
  return (
    <span className="q-pill q-pill--mint q-net" title="QoreChain testnet: tokens have no value" aria-label="Network: QoreChain testnet. Tokens have no value.">
      <span className="q-pill__dot" aria-hidden="true" />
      TESTNET
    </span>
  );
}

// ------------------------------------------------------------------ Card
export function Card({ tone, large, className, children, as: As = "section", ...rest }: { tone?: Tone; large?: boolean; className?: string; children: ReactNode; as?: "section" | "div" | "li" | "article" } & Record<string, unknown>) {
  return (
    <As className={cx("q-card", tone && `q-card--${tone}`, large && "q-card--lg", className)} {...rest}>
      {children}
    </As>
  );
}

// ------------------------------------------------------------------ Sparkline + count-up
/** A small trend line. Values are normalised to the box; decorative, so it's hidden from screen readers. */
export function Sparkline({ values, width = 96, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="q-stat__spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts a number up to its new value in 250ms (instantly under reduced motion). */
export function useCountUp(target: number, ms = 250): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced() || !Number.isFinite(target)) return setV(target);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(a + (target - a) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// ------------------------------------------------------------------ StatCard
/** A big number with its unit, a label and an optional sparkline. `value` undefined = loading skeleton. */
export function StatCard(props: { label: string; value?: number; format?: (n: number) => string; unit?: string; delta?: ReactNode; spark?: number[]; tone?: Tone; children?: ReactNode }) {
  const n = useCountUp(props.value ?? 0);
  const fmt = props.format ?? ((x: number) => Math.round(x).toLocaleString());
  return (
    <Card tone={props.tone} className="q-stat" as="div">
      <span className="q-stat__label">{props.label}</span>
      <div className="q-stat__row">
        {props.value === undefined ? (
          <Skeleton width="60%" height={48} />
        ) : (
          <>
            <span className="q-stat__value" aria-label={`${fmt(props.value)}${props.unit ? ` ${props.unit}` : ""}`}>
              {fmt(n)}
            </span>
            {props.unit && <span className="q-stat__unit">{props.unit}</span>}
          </>
        )}
        {props.spark && <Sparkline values={props.spark} />}
      </div>
      {props.delta && <span className="q-stat__delta q-card__sub">{props.delta}</span>}
      {props.children}
    </Card>
  );
}

// ------------------------------------------------------------------ TokenAmount
/** Format token units for people: thousands separators, at most `maxDecimals`, never scientific notation. */
export function formatUnits(units: bigint, decimals: number, maxDecimals = 4): string {
  const neg = units < 0n;
  const u = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = (u / base).toLocaleString("en-US");
  const frac = (u % base).toString().padStart(decimals, "0").slice(0, maxDecimals).replace(/0+$/, "");
  // Tiny but not zero: say so instead of showing 0.
  if (whole === "0" && !frac && u > 0n) return `${neg ? "−" : ""}<0.${"0".repeat(Math.max(0, maxDecimals - 1))}1`;
  return `${neg ? "−" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function TokenAmount({ units, decimals, symbol, maxDecimals, className }: { units: bigint; decimals: number; symbol: string; maxDecimals?: number; className?: string }) {
  const s = formatUnits(units, decimals, maxDecimals);
  return (
    <span className={cx("q-amount", className)} aria-label={`${s} ${symbol}`}>
      {s}
      <span className="q-amount__sym">{symbol}</span>
    </span>
  );
}

// ------------------------------------------------------------------ AddressChip
/** First 6 + last 4 characters (0x1234…cdef / qor1ab…wxyz), full address on hover and to screen readers, copy button. */
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function AddressChip({ address, label = "Address" }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="q-addr" title={address}>
      <span aria-label={`${label}: ${address}`}>{shortAddr(address)}</span>
      <button
        className="q-addr__copy"
        type="button"
        aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            /* clipboard blocked: the full address is in the tooltip */
          }
        }}
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 10V4a1 1 0 0 1 1-1h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </span>
  );
}

// ------------------------------------------------------------------ Skeleton + EmptyState
/** Loading placeholder: shimmer (still under reduced motion). Use `lines` for text blocks. */
export function Skeleton({ width = "100%", height = 16, lines, radius }: { width?: number | string; height?: number | string; lines?: number; radius?: number }) {
  if (lines)
    return (
      <span aria-hidden="true" style={{ display: "block" }}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="q-skel q-skel--text" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
        ))}
      </span>
    );
  return <span className="q-skel" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}

/** A list with nothing in it: what it is, and the one thing to do next. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="q-empty" role="status">
      <span className="q-empty__icon" aria-hidden="true">
        {icon ?? (
          <svg width="22" height="22" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="q-empty__title">{title}</span>
      {text && <p className="q-empty__text">{text}</p>}
      {action}
    </div>
  );
}
