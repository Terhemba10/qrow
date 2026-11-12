import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { runChecks, worst } from "../agent/checks";
import { fetchExplanation } from "../agent/explain";
import { Explanation } from "../components/Explanation";
import { CheckList, CheckListSkeleton } from "../components/CheckList";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { IconAlert } from "../components/Icons";
import { SignFlow } from "../components/SignFlow";
import { CHAIN } from "../config/network";
import { tokenBySymbol } from "../config/tokens";
import { loadDraft } from "../lib/draft";

export function ReviewPage() {
  const draft = useMemo(() => loadDraft(), []);
  const { address, chainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: CHAIN.id });
  const navigate = useNavigate();
  const [signing, setSigning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const checks = useQuery({
    queryKey: ["checks", address, draft],
    enabled: !!draft && !!tokenBySymbol(draft.token) && !!address && !!client && chainId === CHAIN.id,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: () => runChecks(client!, address!, draft!),
  });

  // The one AI call per send: only after the checks finish, never blocking them or the buttons.
  const explanation = useQuery({
    queryKey: ["explain", checks.data?.startedAt],
    enabled: !!checks.data,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: () => fetchExplanation(checks.data!, draft!, tokenBySymbol(draft!.token)!),
  });

  if (!draft || !tokenBySymbol(draft.token) || !isConnected || chainId !== CHAIN.id) return <Navigate to="/send" replace />;
  const token = tokenBySymbol(draft.token)!;
  const level = checks.data ? worst(checks.data.results) : undefined;
  const blocked = level === "block";
  const needsAck = level === "danger";

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="sheet__head">
        <h1 id="review-title">Check before you send</h1>
        <p className="muted">Qrow checked this payment. Nothing has been sent.</p>
      </div>

      <div className="review__grid">
        <div className="review__main">
          {checks.isPending && <CheckListSkeleton />}
          {checks.isError && (
            <div className="notice notice--warn" role="alert">
              <p className="notice__title">
                <IconAlert /> The checks couldn’t run
              </p>
              <p>Qrow couldn’t reach the testnet, so it can’t confirm this payment is safe. Try again in a moment.</p>
              <button className="btn" type="button" onClick={() => void checks.refetch()}>
                Run the checks again
              </button>
            </div>
          )}
          {checks.data && (
            <ConfirmSheet draft={draft} token={token} warnings={checks.data.results.filter((r) => r.level !== "ok" && r.level !== "info")} />
          )}
          {checks.data && (
            <Explanation state={explanation.data ? { pending: false, ex: explanation.data } : { pending: true }} />
          )}

          {checks.data && !signing && (
            <div className="actions">
              {needsAck && (
                <label className="ack">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>I’ve checked the full address with the recipient another way, and it’s correct.</span>
                </label>
              )}
              {blocked && <p className="field-error">This payment can’t be sent as it is. Fix what’s marked “Can’t send” and check again.</p>}
              <div className="row">
                <button className="btn btn--quiet" type="button" onClick={() => navigate("/send")}>
                  Cancel
                </button>
                <button className="btn" type="button" disabled={blocked || (needsAck && !acknowledged)} onClick={() => setSigning(true)}>
                  Confirm &amp; Send
                </button>
              </div>
            </div>
          )}

          {signing && address && <SignFlow sender={address} draft={draft} token={token} onCancel={() => setSigning(false)} />}
        </div>

        <aside className="review__side">{checks.data && <CheckList run={checks.data} />}</aside>
      </div>
    </section>
  );
}
