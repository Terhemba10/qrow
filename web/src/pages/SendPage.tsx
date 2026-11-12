import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useSwitchChain } from "wagmi";
import { IconAlert, IconInfo } from "../components/Icons";
import { CHAIN, NETWORK_NAME, REFUND_DAYS, networkLabel } from "../config/network";
import { TOKENS, tokenBySymbol, type TokenSymbol } from "../config/tokens";
import { parseRecipient } from "../lib/address";
import { displayAmount, parseAmount } from "../lib/amount";
import { useTokenBalance } from "../lib/balances";
import { NOTE_MAX, loadDraft, saveDraft } from "../lib/draft";

const AMOUNT_ERRORS = {
  empty: "Enter an amount.",
  format: "Use digits and one decimal point, for example 25 or 0.5.",
  zero: "The amount must be more than zero.",
} as const;

const RECIPIENT_ERRORS = {
  empty: "Enter the recipient's address.",
  format: "That isn't a QoreChain address. It should start with 0x or qor1.",
  checksum: "This 0x address has a capitalisation error, so it may be mistyped. Copy it again from the recipient.",
  bech32: "This qor1 address has a typo: its checksum doesn't match. Copy it again from the recipient.",
} as const;

export function SendPage() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const navigate = useNavigate();
  const ids = { to: useId(), amount: useId(), note: useId(), toErr: useId(), amtErr: useId() };

  const prev = useMemo(() => loadDraft(), []);
  const [to, setTo] = useState(prev?.recipient ?? "");
  const [symbol, setSymbol] = useState<TokenSymbol>(prev?.token ?? "fUSD");
  const [amount, setAmount] = useState("");
  const [freelancer, setFreelancer] = useState(prev?.freelancer ?? false);
  const [note, setNote] = useState(prev?.note ?? "");
  const [submitted, setSubmitted] = useState(false);

  const token = tokenBySymbol(symbol)!;
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
          <p className="muted">The money waits in escrow until the recipient claims it. If they don't claim it within {REFUND_DAYS} days, it comes back to you.</p>
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
      source: "typed",
      token: token.symbol,
      amountUnits: parsed.units.toString(),
      freelancer,
      note: note.slice(0, NOTE_MAX),
    });
    navigate("/review");
  }

  return (
    <section className="sheet" aria-labelledby="send-title">
      <div className="sheet__head">
        <h1 id="send-title">Send a payment</h1>
        <p className="muted">The money waits in escrow until the recipient claims it. If they don't claim it within {REFUND_DAYS} days, it comes back to you.</p>
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

      <form className="panel" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.to}>Recipient's address</label>
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
              {selfSend ? "That's your own address. Choose someone else to pay." : recipientError}
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
            <span className="mode__desc">They claim it whenever they're ready.</span>
          </label>
          <label className="mode">
            <input type="radio" name="mode" checked={freelancer} onChange={() => setFreelancer(true)} />
            <span className="mode__title">I release it</span>
            <span className="mode__desc">For work: you release it when it's delivered.</span>
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor={ids.note}>Note for the recipient (optional)</label>
          <textarea id={ids.note} className="input" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} aria-describedby={`${ids.note}-hint`} />
          <span className="counter" aria-live="polite">
            {note.length}/{NOTE_MAX}
          </span>
          <p className="hint" id={`${ids.note}-hint`}>
            Encrypted so only the recipient can read it.
          </p>
        </div>

        <div className="actions">
          <button className="btn btn--block" type="submit" disabled={wrongNetwork}>
            Check this payment
          </button>
          <p className="hint">Next, Qrow checks the address and the amount. You'll see every detail before you sign.</p>
        </div>
      </form>
    </section>
  );
}
