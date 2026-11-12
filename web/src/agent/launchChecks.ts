/**
 * Checks before a memecoin launch. Deterministic, no AI. The factory enforces the hard rules on
 * chain (format, supply, creator share, exact impersonation list); these add what a contract can't
 * cheaply do: lookalike spellings, duplicates of coins already launched, and scam-pattern wording.
 */
import type { Level } from "./checks";

export interface LaunchInput {
  name: string;
  symbol: string;
  supply: string; // whole tokens, as typed
  creatorPct: string; // percent, as typed
  description: string;
}
export interface LaunchCheck {
  id: string;
  level: Level;
  title: string;
  detail?: string;
}

/** Same lists as QrowCoinFactory._impersonates (kept in step by a unit test on a few entries). */
export const PROTECTED_NAMES = [
  "bitcoin", "ethereum", "ether", "qorechain", "qore", "qrow", "tether", "usdc", "usdt", "dogecoin",
  "shiba", "pepe", "solana", "binance", "ripple", "cardano", "polkadot", "chainlink", "litecoin", "tron",
  "avalanche", "polygon", "coinbase", "metamask", "uniswap", "circle", "paypal", "stablecoin", "toncoin", "monero",
];
export const PROTECTED_TICKERS = [
  "BTC", "ETH", "QOR", "USD", "USDT", "USDC", "DAI", "BNB", "SOL", "XRP", "ADA", "DOGE",
  "SHIB", "PEPE", "TRX", "DOT", "LINK", "LTC", "AVAX", "MATIC", "POL", "TON", "XMR", "QROW",
];
const SUBSTRING_TICKERS = ["BTC", "ETH", "QOR", "USD"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g" };
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const unleet = (s: string) => squash(s).replace(/[0-9]/g, (d) => LEET[d] ?? d);

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Names that look like a protected one: exact substring (the chain refuses those), leetspeak, or one letter off. */
export function lookalikeName(name: string): { matched: string; how: "exact" | "spelling" } | undefined {
  const plain = squash(name);
  const de = unleet(name);
  for (const p of PROTECTED_NAMES) if (plain.includes(p)) return { matched: p, how: "exact" };
  for (const p of PROTECTED_NAMES) if (de.includes(p)) return { matched: p, how: "spelling" };
  const words = [de, ...name.toLowerCase().split(/\s+/).map(unleet)];
  for (const w of words)
    for (const p of PROTECTED_NAMES) {
      if (p.length < 6 || w.length < 5) continue; // short names (ether, pepe, shiba) only by exact or leetspeak match: "Ethel" is a real name
      // One letter off the whole word, or a word that contains a near-copy of the name.
      if (editDistance(w, p) <= 1) return { matched: p, how: "spelling" };
      for (let i = 0; i + p.length - 1 <= w.length; i++) {
        for (const len of [p.length - 1, p.length, p.length + 1]) {
          const part = w.slice(i, i + len);
          if (part.length === len && editDistance(part, p) <= 1) return { matched: p, how: "spelling" };
        }
      }
    }
  return undefined;
}

export function lookalikeTicker(symbol: string): { matched: string; how: "exact" | "spelling" } | undefined {
  const s = symbol.toUpperCase();
  for (const t of PROTECTED_TICKERS) if (SUBSTRING_TICKERS.includes(t) ? s.includes(t) : s === t) return { matched: t, how: "exact" };
  const de = unleet(symbol).toUpperCase();
  for (const t of PROTECTED_TICKERS) if (SUBSTRING_TICKERS.includes(t) ? de.includes(t) : de === t) return { matched: t, how: "spelling" };
  return undefined;
}

const HYPE = /\b(guarantee[ds]?|100x|1000x|risk[- ]?free|profit|returns?|moon|get rich|official|airdrop|presale|invest(ment)?)\b/i;
const LINK = /(https?:\/\/|www\.|\.(com|io|xyz|net|org|app)\b|t\.me\/|discord\.gg)/i;

export const MAX_SUPPLY = 1_000_000_000_000n;
export const MIN_SUPPLY = 1_000n;

export function launchChecks(input: LaunchInput, existing: { name: string; symbol: string }[]): LaunchCheck[] {
  const out: LaunchCheck[] = [];
  const name = input.name;
  const symbol = input.symbol;

  // Format: mirrors the contract, so nothing is signed that the chain would refuse.
  const nameOk = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(name) && name.length >= 3 && name.length <= 32;
  out.push(nameOk ? { id: "name", level: "ok", title: "Name format is valid" } : { id: "name", level: "block", title: "Name: 3 to 32 letters, digits and single spaces", detail: "No symbols, emoji or spaces at the start or end." });
  const symOk = /^[A-Z0-9]{2,8}$/.test(symbol);
  out.push(symOk ? { id: "symbol", level: "ok", title: "Symbol format is valid" } : { id: "symbol", level: "block", title: "Symbol: 2 to 8 capital letters or digits" });

  let supply: bigint | undefined;
  try {
    supply = /^\d{1,13}$/.test(input.supply.trim()) ? BigInt(input.supply.trim()) : undefined;
  } catch {
    supply = undefined;
  }
  out.push(
    supply !== undefined && supply >= MIN_SUPPLY && supply <= MAX_SUPPLY
      ? { id: "supply", level: "ok", title: "Supply is within the limits", detail: "Fixed forever: the coin has no mint function." }
      : { id: "supply", level: "block", title: "Supply: 1,000 to 1,000,000,000,000 whole tokens" },
  );

  const pct = Number(input.creatorPct);
  const pctOk = input.creatorPct.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 10 && Math.round(pct * 100) === pct * 100;
  if (!pctOk) out.push({ id: "creator", level: "block", title: "Your share: 0% to 10%, at most two decimals" });
  else if (pct > 5) out.push({ id: "creator", level: "warn", title: `Large creator share (${pct}%)`, detail: "People treat big creator holdings as a rug-pull risk. Everyone can see your share on chain." });
  else out.push({ id: "creator", level: "ok", title: `Creator share ${pct}%`, detail: "Public on chain. The rest is claimable by anyone with a quantum-safe key." });

  if (new TextEncoder().encode(input.description).length > 280) out.push({ id: "desc", level: "block", title: "Description: at most 280 bytes" });
  else if (LINK.test(input.description)) out.push({ id: "desc", level: "warn", title: "The description contains a link", detail: "Links in coin descriptions are a common phishing route. Wallets will show this text to everyone." });
  else if (HYPE.test(input.description)) out.push({ id: "desc", level: "warn", title: "The description sounds like a promise of profit", detail: "This is a testnet memecoin with no value. Don’t suggest returns." });
  else out.push({ id: "desc", level: "ok", title: "Description is fine" });

  if (nameOk) {
    const n = lookalikeName(name);
    if (n?.how === "exact") out.push({ id: "impersonation", level: "block", title: `The name contains “${n.matched}”`, detail: "Names of real coins, chains and brands are refused, on chain too." });
    else if (n) out.push({ id: "impersonation", level: "block", title: `The name looks like “${n.matched}”`, detail: "Lookalike spellings of real coins and brands are how scam tokens trick people. Pick a name of your own." });
    else out.push({ id: "impersonation", level: "ok", title: "The name doesn’t imitate a known coin or brand" });
  }
  if (symOk) {
    const t = lookalikeTicker(symbol);
    if (t) out.push({ id: "ticker", level: "block", title: `The symbol ${t.how === "exact" ? "uses" : "looks like"} ${t.matched}`, detail: "Tickers of real coins (and BTC, ETH, USD or QOR anywhere in one) are refused." });
    else out.push({ id: "ticker", level: "ok", title: "The symbol doesn’t imitate a known ticker" });
  }

  const sameSym = existing.filter((c) => c.symbol === symbol).length;
  const sameName = existing.filter((c) => squash(c.name) === squash(name)).length;
  if (symOk && sameSym) out.push({ id: "dupSymbol", level: "warn", title: `${sameSym} coin${sameSym > 1 ? "s" : ""} already use${sameSym > 1 ? "" : "s"} ${symbol}`, detail: "Allowed, but people may confuse them. Qrow labels duplicates in the coin list." });
  if (nameOk && sameName) out.push({ id: "dupName", level: "warn", title: "A coin with this name already exists", detail: "Allowed, but it will look like a copy." });
  return out;
}
