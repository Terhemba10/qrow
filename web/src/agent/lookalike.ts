/**
 * Address-poisoning detection. People check the start and the end of an address; poisoners make
 * an address that matches both. Rule (from the brief): compare the FULL address with every past
 * recipient; if the first 4 and last 4 hex characters match a past recipient but the address is
 * different, it's a possible scam.
 */
export interface LookalikeHit {
  /** The past recipient it imitates. */
  pastRecipient: string;
  /** 0-based positions (in the 40 hex characters) where the two addresses differ. */
  differsAt: number[];
}

const hex40 = (a: string) => a.toLowerCase().replace(/^0x/, "");

export function findLookalikes(candidate: string, pastRecipients: Iterable<string>): LookalikeHit[] {
  const c = hex40(candidate);
  if (!/^[0-9a-f]{40}$/.test(c)) return [];
  const hits: LookalikeHit[] = [];
  const seen = new Set<string>();
  for (const p of pastRecipients) {
    const r = hex40(p);
    if (!/^[0-9a-f]{40}$/.test(r) || r === c || seen.has(r)) continue;
    seen.add(r);
    if (r.slice(0, 4) === c.slice(0, 4) && r.slice(-4) === c.slice(-4)) {
      const differsAt: number[] = [];
      for (let i = 0; i < 40; i++) if (r[i] !== c[i]) differsAt.push(i);
      hits.push({ pastRecipient: p, differsAt });
    }
  }
  return hits;
}
