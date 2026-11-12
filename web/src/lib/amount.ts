/**
 * Exact decimal ↔ base-unit conversion. Never uses floating point for money.
 * Accepts only plain decimals: digits with at most one ".", no sign, exponent, spaces or separators.
 */
export type ParsedAmount = { ok: true; units: bigint } | { ok: false; reason: AmountError };
export type AmountError = "empty" | "format" | "zero" | "decimals";

const PLAIN = /^(?:\d+)(?:\.\d+)?$|^\.\d+$/;

export function parseAmount(input: string, decimals: number): ParsedAmount {
  const s = input.trim();
  if (s === "") return { ok: false, reason: "empty" };
  if (!PLAIN.test(s)) return { ok: false, reason: "format" };
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > decimals) return { ok: false, reason: "decimals" };
  const units = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  if (units === 0n) return { ok: false, reason: "zero" };
  return { ok: true, units };
}

/** Base units → plain decimal string, trailing zeros trimmed (never rounded). */
export function formatUnitsExact(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/** Group the whole part for display only (amounts are never translated). */
export function displayAmount(units: bigint, decimals: number): string {
  const [w, f] = formatUnitsExact(units, decimals).split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}
