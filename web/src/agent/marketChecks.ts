/**
 * Deterministic checks before a market buy or listing. Same rules as payments: plain code decides,
 * nothing here depends on AI, and a check that can't run is never treated as passed.
 */
import type { CheckResult, Level } from "./checks";
import { findLookalikes } from "./lookalike";

export interface MarketCheckInput {
  side: "buy" | "list";
  price: bigint;
  /** Lowest active price in the same currency, excluding this listing; undefined when none. */
  floor: bigint | undefined;
  counterparty?: string; // seller, when buying
  me: string;
  /** Addresses this wallet traded or paid with before (for the lookalike rule). */
  pastCounterparties: Iterable<string>;
  balance?: bigint; // what the buyer can spend in this currency
  fmt: (units: bigint) => string;
}

const r = (id: string, level: Level, title: string, detail?: string): CheckResult => ({ id: id as never, level, title, detail, ms: 0 });

export function marketChecks(i: MarketCheckInput): CheckResult[] {
  const out: CheckResult[] = [];
  if (i.price <= 0n) out.push(r("price", "block", "The price must be more than zero"));

  if (i.floor === undefined || i.floor === 0n) {
    out.push(r("floor", "info", "No other listing to compare with", "This is the only active listing in this currency."));
  } else if (i.side === "buy" && i.price > i.floor * 3n) {
    out.push(r("floor", "warn", "This costs more than 3× the floor price", `The cheapest listing is ${i.fmt(i.floor)}. Make sure you want this one.`));
  } else if (i.side === "list" && i.price * 2n < i.floor) {
    out.push(r("floor", "warn", "You’re listing below half the floor price", `The cheapest listing is ${i.fmt(i.floor)}. A typo in the price can’t be undone once someone buys.`));
  } else if (i.side === "list" && i.price > i.floor * 10n) {
    out.push(r("floor", "info", "Your price is over 10× the floor", `The cheapest listing is ${i.fmt(i.floor)}.`));
  } else {
    out.push(r("floor", "ok", "The price is in line with the floor", `Floor: ${i.fmt(i.floor)}.`));
  }

  if (i.side === "buy" && i.counterparty) {
    if (i.counterparty.toLowerCase() === i.me.toLowerCase()) {
      out.push(r("seller", "block", "This is your own listing"));
    } else {
      const hits = findLookalikes(i.counterparty, i.pastCounterparties);
      out.push(
        hits.length
          ? { ...r("seller", "danger", "Possible scam: the seller’s address imitates one you’ve dealt with", "It starts and ends like an address from your history but the middle is different."), lookalike: hits }
          : r("seller", "ok", "The seller’s address doesn’t imitate anyone you’ve dealt with"),
      );
    }
  }

  if (i.side === "buy" && i.balance !== undefined) {
    out.push(i.balance >= i.price ? r("balance", "ok", "You have enough to pay") : r("balance", "block", "Not enough to pay", `You have ${i.fmt(i.balance)} and this costs ${i.fmt(i.price)}.`));
  }
  return out;
}
