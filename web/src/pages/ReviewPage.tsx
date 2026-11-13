import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { encodeFunctionData, type Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { runChecks, worst } from "../agent/checks";
import { fetchExplanation } from "../agent/explain";
import { rememberRecipient } from "../agent/recipients";
import { ActionFlow, BlockerNote } from "../components/ActionFlow";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Explanation } from "../components/Explanation";
import { IconAlert } from "../components/Icons";
import { CHAIN, ESCROW, REFUND_SECONDS, REFUND_TEXT } from "../config/network";
import { tokenAddress, tokenBySymbol } from "../config/tokens";
import { displayAmount, formatUnitsExact } from "../lib/amount";
import { clearDraft, loadDraft } from "../lib/draft";
import { signCreate } from "../lib/pq";
import { recipientKemKey, sealNotice } from "../lib/seal";
import { paymentRef } from "../lib/verify";

/**
 * Send, step 2 of 2: the one confirm screen. Qrow's checks run silently and only what needs your
 * attention shows; then one QoreX approval sends it (lib/action.ts).
 */
export function ReviewPage() {
  const draft = useMemo(() => loadDraft(), []);
  const { address, chainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: CHAIN.id });
  const navigate = useNavigate();
  const [acknowledged, setAcknowledged] = useState(false);
  const expectedId = useRef<bigint>(0n);

  const checks = useQuery({
    queryKey: ["checks", address, draft],
    enabled: !!draft && !!tokenBySymbol(draft.token) && !!address && !!client && chainId === CHAIN.id,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: () => runChecks(client!, address!, draft!),
  });
  const attention = checks.data?.results.filter((r) => r.level === "warn" || r.level === "danger") ?? [];
  const block = checks.data?.results.find((r) => r.level === "block");

  // The one AI call per send, only when something needs explaining.
  const explanation = useQuery({
    queryKey: ["explain", checks.data?.startedAt],
    enabled: !!checks.data && attention.length > 0 && !block,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: () => fetchExplanation(checks.data!, draft!, tokenBySymbol(draft!.token)!),
  });

  if (!draft || !tokenBySymbol(draft.token) || !isConnected || chainId !== CHAIN.id || !address) return <Navigate to="/send" replace />;
  const token = tokenBySymbol(draft.token)!;
  const level = checks.data ? worst(checks.data.results) : undefined;
  const blocked = level === "block";
  const needsAck = level === "danger";
  const amount = BigInt(draft.amountUnits);
  const tokenAddr = tokenAddress(token);

  return (
    <section className="review page" aria-labelledby="review-title">
      <div className="sheet__head">
        <h1 id="review-title">Confirm and send</h1>
        <p className="muted">Nothing is sent until you approve in QoreX.</p>
        <button className="btn btn--quiet" type="button" onClick={() => navigate("/send")}>
          Edit payment
        </button>
      </div>

      {checks.isPending && <p className="hint" aria-busy="true">Checking the payment…</p>}
      {checks.isError && (
        <div className="notice notice--warn" role="alert">
          <p className="notice__title">
            <IconAlert /> Couldn’t reach the testnet to check this payment
          </p>
          <button className="btn" type="button" onClick={() => void checks.refetch()}>
            Check again
          </button>
        </div>
      )}
      {block && (
        <BlockerNote
          b={{
            id: "token",
            text: `${block.title}. ${block.detail ?? ""}`.trim(),
            fix: block.id === "balance" ? { label: `Get free ${token.symbol}`, to: "/faucet" } : { label: "Change the payment", to: "/send" },
          }}
        />
      )}
      {checks.data && <ConfirmSheet draft={draft} token={token} warnings={block ? [] : attention} />}
      {!block && explanation.data?.ok && <Explanation state={{ pending: false, ex: explanation.data }} />}

      {checks.data && needsAck && (
        <label className="ack">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>I’ve checked the full address with the recipient another way, and it’s correct.</span>
        </label>
      )}

      {checks.data && !blocked && (!needsAck || acknowledged) && token.address && (
        <ActionFlow
          title={`Send ${displayAmount(amount, token.decimals)} ${token.symbol}`}
          details={[]}
          hideTitle
          confirmLabel="Send in QoreX"
          onCancel={() => navigate("/send")}
          onDone={() => {
            rememberRecipient(address, draft.recipient);
            clearDraft();
          }}
          receipt={() => ({
            kind: "Payment",
            title: `Payment sent: ${displayAmount(amount, token.decimals)} ${token.symbol}`,
            ref: expectedId.current ? paymentRef(expectedId.current) : undefined,
            lines: [
              { name: "To", value: draft.recipient },
              { name: "Released", value: draft.freelancer ? "When you release it" : `When they claim it (or back to you after ${REFUND_TEXT})` },
            ],
          })}
          plan={{
            user: address,
            contract: ESCROW,
            approve: { token: tokenAddr, amount, symbol: token.symbol, decimals: token.decimals },
            build: async ({ key, sign }) => {
              const mode = draft.freelancer ? 1 : 0;
              let sealedNote: Hex = "0x";
              const kem = await recipientKemKey(draft.recipient).catch(() => undefined);
              if (kem) {
                sealedNote = sealNotice(kem, {
                  v: 1,
                  amount: formatUnitsExact(amount, token.decimals),
                  token: token.symbol,
                  from: address,
                  claimBefore: new Date(Date.now() + REFUND_SECONDS * 1000).toISOString(),
                  ...(draft.note ? { note: draft.note } : {}),
                });
              }
              const s = await signCreate(client!, key, address, { recipient: draft.recipient, token: tokenAddr, amount, mode, sealedNote });
              expectedId.current = (await client!.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" })) + 1n;
              const args = [draft.recipient, tokenAddr, amount, mode, sealedNote, s.validUntil, sign(s.signature)] as const;
              return { to: ESCROW, data: encodeFunctionData({ abi: qrowEscrowAbi, functionName: "createPayment", args }) };
            },
          }}
        />
      )}
      {checks.data && !token.address && <p className="field-error">QOR payments come with the next contract update. Choose fUSD, fETH or fBTC.</p>}
    </section>
  );
}
