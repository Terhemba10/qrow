import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAccount, useSwitchChain } from "wagmi";
import { IconAlert, IconInfo } from "../components/Icons";
import { CHAIN, NETWORK_NAME, REFUND_TEXT, networkLabel } from "../config/network";
import { TOKENS, launchedCoins, tokenBySymbol, tokenKey, type TokenSymbol } from "../config/tokens";
import { useCoins } from "../lib/coins";
import { parseRecipient } from "../lib/address";
import { displayAmount, parseAmount } from "../lib/amount";
import { useTokenBalance } from "../lib/balances";
import { loadDraft, saveDraft } from "../lib/draft";
import { formatUnitsExact } from "../lib/amount";
import { usePayments } from "../lib/payments";
import { explainParseError, parsePayload } from "../lib/qrPayload";
import { PaymentList } from "../components/PaymentList";
import { useQuery } from "@tanstack/react-query";
import { recipientKemKey } from "../lib/seal";

const AMOUNT_ERRORS = {
  empty: "Enter an amount.",
  format: "Use digits and one decimal point, for example 25 or 0.5.",
  zero: "The amount must be more than zero.",
} as const;

const RECIPIENT_ERRORS = {
  empty: "Enter the recipient’s address.",
  format: "That isn’t a QoreChain address. It should start with 0x or qor1.",
  checksum: "This 0x address has a capitalisation error, so it may be mistyped. Copy it again from the recipient.",
  bech32: "This qor1 address has a typo: its checksum doesn’t match. Copy it again from the recipient.",
} as const;

function NoteField({ recipient, note, setNote }: { recipient?: `0x${string}`; note: string; setNote: (s: string) => void }) {
  const id = useId();
  const kem = useQuery({ queryKey: ["kem", recipient], enabled: !!recipient, staleTime: 60_000, queryFn: () => recipientKemKey(recipient!).then((k) => !!k) });
  return (
    <div className="field">
      <label htmlFor={id}>Note for the recipient (optional)</label>
      <textarea id={id} className="input" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-hint`} disabled={kem.data === false} />
      <span className="counter" aria-live="polite">
        {note.length}/140
      </span>
      <p className="hint" id={`${id}-hint`}>
        {!recipient
          ? "Encrypted with QoreSeal (ML-KEM-1024) so only the recipient can read it."
          : kem.isPending
            ? "Checking whether the recipient can receive encrypted notes…"
            : kem.data
              ? "Encrypted with QoreSeal (ML-KEM-1024) so only the recipient can read it. They also get a sealed notice of this payment."
              : "This recipient hasn’t set up encrypted notes (no ML-KEM key on chain), so no note or notice can be sent. The payment itself works the same."}
      </p>
    </div>
  );
}

export function SendPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const navigate = useNavigate();
  const ids = { to: useId(), amount: useId(), toErr: useId(), amtErr: useId() };

  // A payment-request link (?pay=qrow:pay?...) only pre-fills the form; every check still runs.
  const [search] = useSearchParams();
  const request = useMemo(() => {
    const raw = search.get("pay");
    return raw ? parsePayload(raw, CHAIN.id) : undefined;
  }, [search]);
  const req = request?.ok ? request.request : undefined;
  const prev = useMemo(() => (req ? undefined : loadDraft()), [req]);
  const [to, setTo] = useState<string>(req?.to ?? prev?.recipient ?? "");
  const [symbol, setSymbol] = useState<TokenSymbol>(req?.token ?? prev?.token ?? "fUSD");
  const [amount, setAmount] = useState(req?.token && req.amountUnits !== undefined ? formatUnitsExact(req.amountUnits, tokenBySymbol(req.token)!.decimals) : "");
  const sent = usePayments(isConnected && chainId === CHAIN.id ? address : undefined);
  const [freelancer, setFreelancer] = useState(prev?.freelancer ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState(prev?.note ?? "");

  const launched = useCoins().data; // also registers launched coins so they can be sent
  const token = tokenBySymbol(symbol) ?? tokenBySymbol("fUSD")!;
  const recipient = parseRecipient(to);
  const parsed = parseAmount(amount, token.decimals);
  const balance = useTokenBalance(address, token);
  const wrongNetwork = isConnected && chainId !== CHAIN.id;

  const recipientError = !recipient.ok && (submitted || recipient.reason !== "empty") ? RECIPIENT_ERRORS[recipient.reason] : undefined;
  const amountError = !parsed.ok && (submitted || parsed.reason !== "empty")
    ? parsed.reason === "decimals"
      ? `${token.symbol} allows at most ${token.decimals} decimal places.`
      : AMOUNT_ERRORS[parsed.reason]
    : undefined;
  const selfSend = recipient.ok && address && recipient.evm.toLowerCase() === address.toLowerCase();

  if (!isConnected) {
    return (
      <section className="sheet" aria-labelledby="send-title">
        <div className="sheet__head">
          <h1 id="send-title">Send a payment</h1>
          <p className="muted">The money waits in escrow until the recipient claims it. If they don’t claim it within {REFUND_TEXT}, it comes back to you.</p>
        </div>
        <div className="panel empty">
          <h2>Connect your wallet to start</h2>
          <p className="muted">Qrow reads your balance and checks every payment before you sign. Nothing is sent until you confirm it in your wallet.</p>
          <button className="btn" type="button" onClick={openConnectModal}>
            Connect wallet
          </button>
        </div>
      </section>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!recipient.ok || !parsed.ok || selfSend || wrongNetwork) return;
    saveDraft({
      recipient: recipient.evm,
      recipientQor: recipient.qor,
      source: req && recipient.ok && recipient.evm === req.to ? "qr" : "typed",
      token: tokenKey(token),
      amountUnits: parsed.units.toString(),
      freelancer,
      note: note.trim().slice(0, 140),
    });
    navigate("/review");
  }

  return (
    <section className="sheet" aria-labelledby="send-title">
      <div className="sheet__head">
        <h1 id="send-title">Send a payment</h1>
        <p className="muted">The money waits in escrow until the recipient claims it. If they don’t claim it within {REFUND_TEXT}, it comes back to you.</p>
      </div>

      {wrongNetwork && (
        <div className="notice notice--warn" role="alert" style={{ marginBottom: "var(--space-lg)" }}>
          <p className="notice__title">
            <IconAlert /> Your wallet is on {networkLabel(chainId)}
          </p>
          <p>Qrow only works on {NETWORK_NAME}. Switch your wallet to continue. Qrow never switches networks by itself.</p>
          <button className="btn" type="button" onClick={() => switchChain({ chainId: CHAIN.id })} aria-busy={switching}>
            {switching ? "Waiting for your wallet…" : `Switch to ${NETWORK_NAME}`}
          </button>
        </div>
      )}

      {request && !request.ok && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: "var(--space-lg)" }}>
          <p className="notice__title">
            <IconAlert /> This payment request can’t be used
          </p>
          <p>{explainParseError(request.error)} Nothing was filled in.</p>
        </div>
      )}
      {req && (
        <div className="notice" style={{ marginBottom: "var(--space-lg)" }}>
          <p className="notice__title">
            <IconInfo /> Filled in from a payment request
          </p>
          <p>Check every detail. Qrow runs all its checks before anything is sent.</p>
          {req.note && (
            <p>
              Their note: <q className="request-note">{req.note}</q>
            </p>
          )}
        </div>
      )}

      <form className="panel" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.to}>Recipient’s address</label>
          <input
            id={ids.to}
            className="input input--mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x… or qor1…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={!!recipientError || !!selfSend}
            aria-describedby={recipientError || selfSend ? ids.toErr : undefined}
          />
          {recipient.ok && (
            <p className="converted">
              {recipient.typed === "qor1" ? (
                <>Same account as <span className="mono">{recipient.evm}</span></>
              ) : (
                <>Same account as <span className="mono">{recipient.qor}</span></>
              )}
            </p>
          )}
          {(recipientError || selfSend) && (
            <p className="field-error" id={ids.toErr}>
              {selfSend ? "That’s your own address. Choose someone else to pay." : recipientError}
            </p>
          )}
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 var(--space-lg)" }}>
          <legend>Token</legend>
          <div className="seg" role="radiogroup">
            {TOKENS.map((t) => (
              <span key={t.symbol}>
                <input type="radio" name="token" id={`tok-${t.symbol}`} value={t.symbol} checked={symbol === t.symbol} onChange={() => setSymbol(t.symbol)} />
                <label htmlFor={`tok-${t.symbol}`}>{t.symbol}</label>
              </span>
            ))}
          </div>
          {(launched?.length ?? launchedCoins().length) > 0 && (
            <div className="field" style={{ marginTop: "var(--space-sm)" }}>
              <label htmlFor="tok-coin" className="hint">
                Or a coin launched in Qrow (testnet memecoin, no value)
              </label>
              <select id="tok-coin" className="input" value={token.qrowCoin ? tokenKey(token) : ""} onChange={(e) => e.target.value && setSymbol(e.target.value)}>
                <option value="">Choose a launched coin</option>
                {launchedCoins().map((c) => (
                  <option key={c.address} value={tokenKey(c)}>
                    {c.symbol}, {c.name} ({c.address!.slice(0, 8)}…)
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor={ids.amount}>Amount</label>
          <div className="amount-row">
            <input
              id={ids.amount}
              className="input fig"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!amountError}
              aria-describedby={`${ids.amount}-bal${amountError ? " " + ids.amtErr : ""}`}
            />
            <span className="btn btn--quiet" aria-hidden="true" style={{ pointerEvents: "none" }}>
              {token.symbol}
            </span>
          </div>
          <div className="balance" id={`${ids.amount}-bal`}>
            <span>
              Available:{" "}
              {balance.status === "loading" ? (
                <span className="skeleton" aria-label="Loading balance" />
              ) : balance.status === "error" ? (
                <span>{balance.message}</span>
              ) : (
                <span className="fig">
                  {displayAmount(balance.evmUnits, token.decimals)} {token.symbol}
                </span>
              )}
            </span>
            {balance.status === "ok" && balance.evmUnits > 0n && (
              <button type="button" className="linkbtn" onClick={() => setAmount(displayAmount(balance.evmUnits, token.decimals).replaceAll(",", ""))}>
                Use all
              </button>
            )}
          </div>
          {balance.status === "ok" && balance.evmUnits === 0n && (balance.bankUnits ?? 0n) > 0n && (
            <p className="hint">
              <IconInfo /> You hold {displayAmount(balance.bankUnits!, token.decimals)} {token.symbol} on the native side of QoreChain. Convert it in QoreX so the escrow can use it.
            </p>
          )}
          {amountError && (
            <p className="field-error" id={ids.amtErr}>
              {amountError}
            </p>
          )}
        </div>

        <fieldset className="modes">
          <legend className="label">How the money is released</legend>
          <label className="mode">
            <input type="radio" name="mode" checked={!freelancer} onChange={() => setFreelancer(false)} />
            <span className="mode__title">Recipient claims it</span>
            <span className="mode__desc">They claim it whenever they’re ready.</span>
          </label>
          <label className="mode">
            <input type="radio" name="mode" checked={freelancer} onChange={() => setFreelancer(true)} />
            <span className="mode__title">I release it</span>
            <span className="mode__desc">For work: you release it when it’s delivered.</span>
          </label>
        </fieldset>

        <NoteField recipient={recipient.ok ? recipient.evm : undefined} note={note} setNote={setNote} />

        <div className="actions">
          <button className="btn btn--block" type="submit" disabled={wrongNetwork}>
            Check this payment
          </button>
          <p className="hint">Next, Qrow checks the address and the amount. You’ll see every detail before you sign.</p>
        </div>
      </form>

      {address && sent.data && sent.data.outgoing.length > 0 && (
        <section className="stack" aria-labelledby="sent-title" style={{ marginTop: "var(--space-xl)" }}>
          <div className="section-head">
            <h2 id="sent-title">Your sent payments</h2>
            <p className="hint fig">{sent.data.outgoing.filter((p) => p.status === "Pending").length} in escrow</p>
          </div>
          <PaymentList me={address} payments={sent.data.outgoing} direction="out" hasPqKey={undefined} onChanged={() => void sent.refetch()} />
        </section>
      )}
    </section>
  );
}
