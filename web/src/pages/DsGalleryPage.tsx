/** Dev only (/dev/ui): every design-system v2 component in its states, to review before the redesign is applied. */
import { useState } from "react";
import { AddressChip, Button, Card, EmptyState, NetworkBadge, Pill, Skeleton, StatCard, TokenAmount, TxReviewSheet, txToast } from "../ds";

const QOR = { decimals: 6, symbol: "QOR" };
const FUSD = { decimals: 6, symbol: "fUSD" };

export function DsGalleryPage() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="page ds-gallery" style={{ background: "var(--q-ink)", display: "grid", gap: 32 }} aria-labelledby="dsg">
      <h1 id="dsg" className="q-display q-h1">
        Qrow design system
      </h1>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Button>Confirm in QoreX</Button>
        <Button variant="cyan">Trade</Button>
        <Button variant="orange">Predict</Button>
        <Button variant="mint">Claim</Button>
        <Button variant="light">Mint</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="quiet" size="sm">
          Details
        </Button>
        <Button loading>Sending</Button>
        <Button disabled>Not enough QOR</Button>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <NetworkBadge />
        <Pill tone="cyan">Crypto</Pill>
        <Pill tone="orange">Ends in 3 days</Pill>
        <Pill tone="brand" dot>
          Quantum-safe
        </Pill>
        <Pill tone="danger">Failed</Pill>
        <AddressChip address="0xD517458c6b083B964342C604D35Be6afC2dCcb37" label="Recipient" />
        <AddressChip address="qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f" label="Your account" />
        <TokenAmount units={1_234_567_890n} {...FUSD} />
      </div>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
        <StatCard tone="cyan" label="Balance" value={1240.5} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })} unit="QOR" spark={[3, 4, 3.6, 5, 4.8, 6.2, 6]} delta="+4.1% this week" />
        <StatCard tone="orange" label="Open positions" value={3} unit="perps" spark={[1, 2, 2, 3, 2, 3]} />
        <StatCard tone="mint" label="Prediction volume" value={4899} unit="fUSD" spark={[2, 3, 5, 4, 6, 8]} />
        <StatCard label="Loading" />
      </div>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <Card large>
          <h2 className="q-display q-h3" style={{ margin: "0 0 12px" }}>
            Loading list
          </h2>
          <Skeleton lines={3} />
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Skeleton width={64} height={64} radius={16} />
            <Skeleton width="70%" height={64} />
          </div>
        </Card>
        <EmptyState title="No positions yet" text="Open a long or short on any pair. Your positions and their PnL show up here." action={<Button variant="cyan">Open a position</Button>} />
        <Card tone="light" large>
          <h2 className="q-display q-h3" style={{ margin: "0 0 8px" }}>
            Recent activity
          </h2>
          <p className="q-card__sub">The white panel, for lists of what happened.</p>
        </Card>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button onClick={() => setOpen(true)}>Open TxReviewSheet</Button>
        <Button variant="quiet" onClick={() => txToast({ id: "a", state: "pending", title: "Swap 50 QOR" })}>
          Toast: pending
        </Button>
        <Button variant="quiet" onClick={() => txToast({ id: "a", state: "confirmed", title: "Swap 50 QOR", hash: "4A676D5F23A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F6071829E3CD" })}>
          Toast: confirmed
        </Button>
        <Button variant="quiet" onClick={() => txToast({ id: "b", state: "failed", title: "Open long ETH", text: "Not enough test QOR for the network fee.", fix: { label: "Get free test QOR", to: "/faucet" } })}>
          Toast: failed
        </Button>
      </div>
      <TxReviewSheet
        open={open}
        busy={busy}
        busyText="Approve in QoreX…"
        review={{
          title: "Swap QOR for fUSD",
          send: [{ units: 50_000_000n, ...QOR }],
          get: [{ units: 3_180_000n, ...FUSD, estimate: true }],
          recipient: { label: "To", address: "0xD517458c6b083B964342C604D35Be6afC2dCcb37" },
          facts: [{ name: "Price impact", value: "0.4%" }],
          fee: { total: { units: 62_000n, ...QOR }, estimate: true, lines: [{ label: "Swap", amount: { units: 40_000n, ...QOR } }, { label: "This device’s fees (first time)", amount: { units: 22_000n, ...QOR } }] },
          warning: "Prices on the testnet pool can move between review and confirm.",
        }}
        onConfirm={() => {
          setBusy(true);
          window.setTimeout(() => (setBusy(false), setOpen(false), txToast({ id: "c", state: "confirmed", title: "Swap 50 QOR" })), 1200);
        }}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
