/**
 * QoreChain's public EVM RPC answers eth_getLogs for at most 10,000 blocks per request (error
 * "maximum [from, to] blocks distance: 10000"). Every history scan goes through here: the range is
 * split into windows of CHUNK blocks, fetched a few at a time to stay gentle with the endpoint.
 */
export const CHUNK = 9_000n;

export function blockRanges(from: bigint, to: bigint, size = CHUNK): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) out.push([start, start + size - 1n < to ? start + size - 1n : to]);
  return out;
}

export async function getLogsChunked<T>(from: bigint, to: bigint, fetch: (from: bigint, to: bigint) => Promise<T[]>, concurrency = 3): Promise<T[]> {
  const ranges = blockRanges(from, to);
  const results: T[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      results[i] = await fetch(ranges[i][0], ranges[i][1]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
  return results.flat();
}
