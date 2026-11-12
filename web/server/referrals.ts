/**
 * Referral tracking (no payouts): counts distinct delegators whose MsgDelegate transaction carries
 * the memo "qrow-ref:<referrer>". Read from public chain data since Qrow's launch block; the node
 * prunes older history. Cached for 5 minutes.
 */
const REST = process.env.QROW_REST ?? "https://api-testnet.qore.host";
const FROM_HEIGHT = 9_955_000;
const cache = new Map<string, { at: number; count: number; delegators: string[] }>();

export const isQorAddress = (s: string) => /^qor1[02-9ac-hj-np-z]{38}$/.test(s);

export async function referralCount(ref: string): Promise<{ count: number; delegators: string[] }> {
  const hit = cache.get(ref);
  if (hit && Date.now() - hit.at < 300_000) return hit;
  const q = encodeURIComponent(`message.action='/cosmos.staking.v1beta1.MsgDelegate' AND tx.height>=${FROM_HEIGHT}`);
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&page=${page}&limit=100`);
    if (!r.ok) break;
    const j = (await r.json()) as { txs?: { body: { memo?: string; messages: { delegator_address?: string }[] } }[] };
    const txs = j.txs ?? [];
    for (const t of txs) {
      if (t.body.memo !== `qrow-ref:${ref}`) continue;
      const d = t.body.messages[0]?.delegator_address;
      if (d && d !== ref) seen.add(d);
    }
    if (txs.length < 100) break;
  }
  const out = { at: Date.now(), count: seen.size, delegators: [...seen] };
  cache.set(ref, out);
  return out;
}
