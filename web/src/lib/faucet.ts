/**
 * Faucet helpers. Qrow never claims for the user: the official faucet needs the user's own Dashboard
 * sign-in. Qrow only explains, links, watches the user's balances and recognises a faucet payment.
 * Amounts from docs.qorechain.io/dashboard/faucet (as of 27 Oct 2026): 100 QOR plus 1,000 fUSD,
 * 0.5 fETH and 0.02 fBTC per claim, once per 24 hours per account and per address, paid as bank coins.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { REST } from "../config/network";

export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";
export const CLAIM_INTERVAL_MS = 24 * 3_600_000;

/** The coins the faucet pays, as the bank denoms the chain uses. */
export const FAUCET_COINS = [
  { denom: "uqor", symbol: "QOR", decimals: 6, perClaim: "100" },
  { denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", symbol: "fUSD", decimals: 6, perClaim: "1,000" },
  { denom: "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28", symbol: "fETH", decimals: 18, perClaim: "0.5" },
  { denom: "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A", symbol: "fBTC", decimals: 8, perClaim: "0.02" },
] as const;

export type Balances = Record<string, bigint>;

export async function bankBalances(qor: string): Promise<Balances> {
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${qor}`);
  if (!r.ok) throw new Error(`balances: HTTP ${r.status}`);
  const j = (await r.json()) as { balances: { denom: string; amount: string }[] };
  const out: Balances = {};
  for (const c of FAUCET_COINS) out[c.denom] = BigInt(j.balances.find((b) => b.denom.toLowerCase() === c.denom.toLowerCase())?.amount ?? "0");
  return out;
}

/** What arrived since `base` (only increases). */
export function received(base: Balances, now: Balances): { symbol: string; units: bigint; decimals: number }[] {
  return FAUCET_COINS.flatMap((c) => {
    const d = (now[c.denom] ?? 0n) - (base[c.denom] ?? 0n);
    return d > 0n ? [{ symbol: c.symbol, units: d, decimals: c.decimals }] : [];
  });
}

/**
 * Is this incoming transfer a faucet payment? Exactly 100 QOR, or one transfer carrying all three fest
 * tokens. A heuristic (the docs don't name the faucet's address), so the page labels it "about".
 */
export function looksLikeFaucet(amount: string): boolean {
  const parts = amount.split(",").map((s) => s.trim().toLowerCase());
  if (parts.includes("100000000uqor")) return true;
  const fest = FAUCET_COINS.slice(1).map((c) => c.denom.toLowerCase());
  return fest.every((d) => parts.some((p) => p.endsWith(d)));
}

/** The time of the user's most recent faucet payment seen on chain (recent history only: the node prunes). */
export async function lastFaucetClaim(qor: string): Promise<number | undefined> {
  const q = encodeURIComponent(`transfer.recipient='${qor}'`);
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=30`);
  if (!r.ok) return undefined;
  const j = (await r.json()) as { tx_responses?: { timestamp: string; events: { type: string; attributes: { key: string; value: string }[] }[] }[] };
  for (const t of j.tx_responses ?? []) {
    for (const e of t.events) {
      if (e.type !== "transfer") continue;
      const a = Object.fromEntries(e.attributes.map((x) => [x.key, x.value]));
      if (a.recipient === qor && a.amount && looksLikeFaucet(a.amount)) return Date.parse(t.timestamp);
    }
  }
  return undefined;
}

export function useLastFaucetClaim(qor: string | undefined) {
  return useQuery({ queryKey: ["faucet-last", qor], enabled: !!qor, staleTime: 120_000, queryFn: () => lastFaucetClaim(qor!) });
}

/**
 * Watch balances while the page is visible: every 15 s, paused when the tab is hidden (gentle on the
 * public endpoint). Remembers the balances when watching started, to show what arrived.
 */
export function useBalanceWatcher(qor: string | undefined) {
  const [base, setBase] = useState<Balances>();
  const [now, setNow] = useState<Balances>();
  const [error, setError] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    if (!qor) return;
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const b = await bankBalances(qor);
        if (stopped) return;
        setNow(b);
        setBase((prev) => prev ?? b);
        setError(false);
      } catch {
        if (!stopped) setError(true);
      }
    };
    void tick();
    timer.current = window.setInterval(() => void tick(), 15_000);
    const onVis = () => !document.hidden && void tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVis);
      setBase(undefined);
      setNow(undefined);
    };
  }, [qor]);

  return { base, now, arrived: base && now ? received(base, now) : [], error };
}
