import { useCoins } from "../lib/coins";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { IconAlert } from "../components/Icons";
import { PaymentList } from "../components/PaymentList";
import { RequestPayment } from "../components/RequestPayment";
import { CHAIN } from "../config/network";
import { usePayments } from "../lib/payments";

export function ReceivePage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  useCoins(); // registers launched coins so their payments show by name
  const payments = usePayments(isConnected && chainId === CHAIN.id ? address : undefined);

  if (!isConnected || !address) {
    return (
      <section className="sheet" aria-labelledby="recv-title">
        <div className="sheet__head">
          <h1 id="recv-title">Receive</h1>
          <p className="muted">Payments sent to you wait in escrow until you claim them with your quantum-safe key.</p>
        </div>
        <div className="panel empty">
          <h2>Connect QoreX to see payments for you</h2>
          <button className="btn" type="button" onClick={openConnectModal}>
            Connect QoreX
          </button>
        </div>
      </section>
    );
  }

  const incoming = payments.data?.incoming ?? [];
  const waiting = incoming.filter((p) => p.status === "Pending");
  return (
    <section className="page" aria-labelledby="recv-title">
      <div className="sheet__head">
        <h1 id="recv-title">Receive</h1>
        <p className="muted">Payments sent to you wait in escrow. Claim them before the countdown ends, or they go back to the sender.</p>
      </div>

      <div className="split">
        <section aria-labelledby="in-title" className="stack">
          <div className="section-head">
            <h2 id="in-title">Payments for you</h2>
            {payments.data && <p className="hint fig">{waiting.length} waiting</p>}
          </div>
          {payments.isPending && (
            <ul className="paylist" aria-busy="true">
              {[0, 1].map((i) => (
                <li className="paylist__item" key={i}>
                  <span className="skeleton" style={{ width: "40%" }} />
                  <span className="skeleton" style={{ width: "25%" }} />
                </li>
              ))}
            </ul>
          )}
          {payments.isError && (
            <div className="notice notice--warn" role="alert">
              <p className="notice__title">
                <IconAlert /> Couldn’t load your payments
              </p>
              <p>The testnet didn’t answer. Your money is safe in the escrow either way.</p>
              <button className="btn" type="button" onClick={() => void payments.refetch()}>
                Try again
              </button>
            </div>
          )}
          {payments.data && incoming.length === 0 && (
            <div className="panel empty">
              <h3>No payments for you yet</h3>
              <p className="muted">Share a payment request so people can pay you without typing your address.</p>
            </div>
          )}
          {payments.data && incoming.length > 0 && (
            <PaymentList me={address} payments={incoming} direction="in" onChanged={() => void payments.refetch()} />
          )}
        </section>
        <RequestPayment me={address} />
      </div>
    </section>
  );
}
