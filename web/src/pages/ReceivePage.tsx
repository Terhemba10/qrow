import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { IconAlert } from "../components/Icons";
import { PaymentList } from "../components/PaymentList";
import { RequestPayment } from "../components/RequestPayment";
import { CHAIN, ESCROW } from "../config/network";
import { pqAuthAbi } from "../lib/pqAction";
import { usePayments } from "../lib/payments";

export function ReceivePage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const client = usePublicClient({ chainId: CHAIN.id });
  const payments = usePayments(isConnected && chainId === CHAIN.id ? address : undefined);
  const pqKey = useQuery({
    queryKey: ["hasPqKey", address],
    enabled: !!address && !!client,
    queryFn: () => client!.readContract({ address: ESCROW, abi: pqAuthAbi, functionName: "hasPqKey", args: [address!] }),
  });

  if (!isConnected || !address) {
    return (
      <section className="sheet" aria-labelledby="recv-title">
        <div className="sheet__head">
          <h1 id="recv-title">Receive</h1>
          <p className="muted">Payments sent to you wait in escrow until you claim them with your quantum-safe key.</p>
        </div>
        <div className="panel empty">
          <h2>Connect your wallet to see payments for you</h2>
          <button className="btn" type="button" onClick={openConnectModal}>
            Connect wallet
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

      {pqKey.data === false && (
        <div className="notice notice--warn" role="alert">
          <p className="notice__title">
            <IconAlert /> You can’t claim payments yet
          </p>
          <p>Claiming needs a registered quantum-safe (ML-DSA-87) key. Register one in QoreX. Until then, anything sent to you goes back to the sender after 7 days.</p>
        </div>
      )}

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
            <PaymentList me={address} payments={incoming} direction="in" hasPqKey={pqKey.data} onChanged={() => void payments.refetch()} />
          )}
        </section>
        <RequestPayment me={address} />
      </div>
    </section>
  );
}
