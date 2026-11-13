export const QOREX_URL = "https://qorechain.io/qorex";

/** An address with its first and last 4 characters highlighted (what people actually compare). */
export function AddressChip({ address }: { address: string }) {
  const p = address.startsWith("0x") ? 2 : address.indexOf("1") + 1;
  return (
    <span className="mono addr" title={address}>
      {address.slice(0, p)}
      <mark>{address.slice(p, p + 4)}</mark>
      {address.slice(p + 4, -4)}
      <mark>{address.slice(-4)}</mark>
    </span>
  );
}
