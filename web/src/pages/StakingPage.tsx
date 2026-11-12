import { useId, useState } from "react";
import { useAccount } from "wagmi";
import { evmToQor } from "@qorechain/sdk";
import { IconAlert, IconCheck } from "../components/Icons";
import { Countdown, useNow } from "../components/Countdown";
import { displayAmount, parseAmount } from "../lib/amount";
import { build, earlyUnlockQuote, LOCK_TERMS, qorexAccount, qorexAvailable, REF_MEMO, signInQorex, storedReferral, UQOR, useStaking, type Lock } from "../lib/staking";

const q = (uqor: bigint) => `${displayAmount(uqor, 6)} QOR`;
const fmtDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

type Pending = { title: string; lines: string[]; warn?: string[]; messages: { typeUrl: string; value: unknown }[]; memo?: string };

export function StakingPage() {
  const { address } = useAccount();
  const [qorexAddr, setQorexAddr] = useState<string>();
  const delegator = qorexAddr ?? (address ? evmToQor(address) : undefined);
  const { validators, params, position } = useStaking(delegator);
  const now = useNow(30_000);
  const ids = { amt: useId(), lockAmt: useId() };
  const [validator, setValidator] = useState<string>();
  const [amount, setAmount] = useState("");
  const [lockVal, setLockVal] = useState<string>();
  const [lockAmount, setLockAmount] = useState("");
  const [months, setMonths] = useState<number>(3);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const hasQorex = qorexAvailable();

  const p = params.data;
  const pos = position.data;
  const ref = storedReferral();
  const firstDelegation = pos ? pos.delegations.length === 0 : false;
  const totalStaked = pos?.delegations.reduce((s, d) => s + d.amount, 0n) ?? 0n;
  const totalRewards = pos?.delegations.reduce((s, d) => s + d.rewards, 0n) ?? 0n;
  const unbondDays = p ? Math.round(p.unbondingSeconds / 86_400) : 21;

  async function sign() {
    if (!pending) return;
    setBusy(true);
    setResult(undefined);
    try {
      const r = await signInQorex(pending.messages, pending.memo);
      setResult({ ok: true, text: `Done in QoreX. Transaction ${r.txHash}.` });
      setPending(undefined);
      void position.refetch();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "QoreX refused the request." });
    } finally {
      setBusy(false);
    }
  }

  function prepareDelegate() {
    const a = parseAmount(amount, 6);
    if (!delegator || !validator || !a.ok || !pos) return;
    const v = validators.data?.find((x) => x.operator === validator);
    const warn: string[] = [];
    if (a.units > pos.liquid) warn.push(`You have ${q(pos.liquid)} available, less than ${q(a.units)}.`);
    if (pos.liquid - a.units < UQOR) warn.push("Keep about 1 QOR unstaked for transaction fees.");
    if (v?.jailed) warn.push("This validator is jailed and earns no rewards.");
    const memo = firstDelegation && ref ? REF_MEMO(ref) : undefined;
    setPending({
      title: "Stake QOR",
      lines: [`Stake ${q(a.units)} with ${v?.moniker ?? validator} (${((v?.commission ?? 0) * 100).toFixed(0)}% commission).`, `Unstaking later takes ${unbondDays} days (the chain’s unbonding period).`, ...(memo ? [`Tagged with your referrer’s link (${ref?.slice(0, 10)}…). They get a count and a badge, no payout.`] : [])],
      warn,
      messages: [build.delegate(delegator, validator, a.units)],
      memo,
    });
  }

  function prepareLock() {
    const a = parseAmount(lockAmount, 6);
    const d = pos?.delegations.find((x) => x.validator === lockVal);
    if (!delegator || !lockVal || !a.ok || !p || !d) return;
    const tier = p.tiers.find((t) => t.months === months);
    const warn: string[] = [];
    if (a.units < p.minLock) warn.push(`The chain’s minimum lock is ${q(p.minLock)}.`);
    if (a.units > d.amount) warn.push(`You only have ${q(d.amount)} staked with this validator.`);
    const term = LOCK_TERMS.find((t) => t.months === months)!;
    setPending({
      title: `Lock for ${term.label}`,
      lines: [
        `Lock ${q(a.units)} of your stake for ${term.label} for a +${((tier?.bonusBps ?? 0) / 100).toFixed(1)}% APY bonus on top of staking rewards.`,
        `Ends around ${fmtDate.format(new Date(Date.now() + months * 30.4 * 86_400_000))}.`,
        `Leaving early burns ${(p.earlyUnlockPenaltyBps / 100).toFixed(0)}% of the locked amount and forfeits the bonus. Normal staking rewards you’ve earned are kept.`,
      ],
      warn,
      messages: [build.lock(delegator, lockVal, a.units, months)],
    });
  }

  function prepareUnlock(l: Lock) {
    if (!delegator || !p) return;
    const quote = earlyUnlockQuote(l, p.earlyUnlockPenaltyBps, now);
    setPending({
      title: `End lock #${l.id} early`,
      lines: [
        `You’ve staked ${quote.daysStaked} of ${quote.daysTotal} days. Staking rewards for those days stay yours.`,
        `Burned: ${q(quote.penalty)} (${(p.earlyUnlockPenaltyBps / 100).toFixed(0)}% of ${q(l.amount)}). You keep ${q(quote.keep)} staked.`,
        `Bonus forfeited: ${q(quote.bonusForfeited)}.`,
        `To withdraw the QOR afterwards, unstake it; that takes ${unbondDays} days.`,
      ],
      warn: ["Money is burned. This can’t be undone."],
      messages: [build.unlockEarly(delegator, l.id)],
    });
  }

  function prepareRestake() {
    if (!delegator || !pos) return;
    const withRewards = pos.delegations.filter((d) => d.rewards > 0n);
    if (!withRewards.length) return;
    setPending({
      title: "Claim & restake",
      lines: withRewards.map((d) => `Claim ${q(d.rewards)} from ${validators.data?.find((v) => v.operator === d.validator)?.moniker ?? d.validator} and stake it again with them.`).concat(["One QoreX signature. Nothing is restaked automatically without you."]),
      messages: withRewards.flatMap((d) => [build.withdraw(delegator, d.validator), build.delegate(delegator, d.validator, d.rewards)]),
    });
  }

  return (
    <section className="page" aria-labelledby="stk-title">
      <div className="sheet__head">
        <h1 id="stk-title">Staking</h1>
        <p className="muted">Stake testnet QOR with a validator on QoreChain’s native lane, and optionally lock it for a bonus. Every action is signed in QoreX with your hybrid (ECDSA + ML-DSA-87) signature. Testnet QOR has no value.</p>
      </div>

      {!hasQorex && (
        <div className="notice notice--warn">
          <p className="notice__title">
            <IconAlert /> Staking is signed in QoreX
          </p>
          <p>
            QoreX isn’t available in this browser, so you can view staking but not sign. <a href="https://build.qorechain.io/start" target="_blank" rel="noopener noreferrer">Install QoreX</a> to stake.
          </p>
        </div>
      )}
      {hasQorex && !qorexAddr && (
        <button className="btn" type="button" onClick={() => void qorexAccount().then(setQorexAddr)}>
          Connect QoreX
        </button>
      )}

      <div className="stats">
        <div>
          <p className="label">Staked</p>
          <p className="fig stat">{pos ? q(totalStaked) : "…"}</p>
        </div>
        <div>
          <p className="label">Rewards ready</p>
          <p className="fig stat">{pos ? q(totalRewards) : "…"}</p>
        </div>
        <div>
          <p className="label">Unbonding period</p>
          <p className="fig stat">{unbondDays} days</p>
        </div>
      </div>

      {pending && (
        <section className="panel stack" aria-labelledby="stk-confirm">
          <h2 id="stk-confirm">{pending.title}</h2>
          {pending.warn?.map((w) => (
            <p key={w} className="notice notice--warn">
              {w}
            </p>
          ))}
          <ul className="checks__list">
            {pending.lines.map((l) => (
              <li key={l} className="check">
                <span className="check__icon">
                  <IconCheck />
                </span>
                <p className="check__title">{l}</p>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn btn--quiet" type="button" onClick={() => setPending(undefined)}>
              Cancel
            </button>
            <button className="btn" type="button" disabled={busy || !hasQorex || !qorexAddr} aria-busy={busy} onClick={() => void sign()}>
              {busy ? "Waiting for QoreX…" : "Confirm & sign in QoreX"}
            </button>
          </div>
        </section>
      )}
      {result && <p className={`notice ${result.ok ? "notice--ok" : "notice--danger"}`} role="status">{result.text}</p>}

      <div className="split">
        <section className="stack" aria-labelledby="pos-title">
          <h2 id="pos-title">Your stake</h2>
          {position.isPending && delegator && <span className="skeleton" style={{ width: "70%" }} />}
          {!delegator && <p className="muted">Connect a wallet to see your stake.</p>}
          {pos && pos.delegations.length === 0 && <p className="muted">You’re not staking yet.</p>}
          {pos && pos.delegations.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Validator</th>
                  <th scope="col" className="num">Staked</th>
                  <th scope="col" className="num">Rewards</th>
                </tr>
              </thead>
              <tbody>
                {pos.delegations.map((d) => (
                  <tr key={d.validator}>
                    <th scope="row">{validators.data?.find((v) => v.operator === d.validator)?.moniker ?? d.validator.slice(0, 16)}</th>
                    <td className="num fig">{q(d.amount)}</td>
                    <td className="num fig">{q(d.rewards)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {totalRewards > 0n && (
            <button className="btn" type="button" onClick={prepareRestake}>
              Claim &amp; restake
            </button>
          )}

          <h3>Locks</h3>
          {pos && pos.locks.filter((l) => !l.released).length === 0 && <p className="muted">No active locks.</p>}
          {pos?.locks
            .filter((l) => !l.released)
            .map((l) => (
              <div key={l.id} className="paylist__item">
                <div className="paylist__main">
                  <p className="paylist__amount fig">{q(l.amount)}</p>
                  <p className="hint">
                    {LOCK_TERMS.find((t) => t.months === l.months)?.label} lock, +{(l.bonusBps / 100).toFixed(1)}% APY bonus
                  </p>
                </div>
                <div className="paylist__state">
                  <span className="hint">
                    Ends in <Countdown deadline={l.endTime} now={now} />
                  </span>
                </div>
                <div className="paylist__actions">
                  <button className="btn btn--quiet" type="button" onClick={() => prepareUnlock(l)}>
                    End lock early
                  </button>
                </div>
              </div>
            ))}
        </section>

        <section className="panel stack" aria-labelledby="new-title">
          <h2 id="new-title">Stake</h2>
          <label className="label" htmlFor="stk-val">
            Validator
          </label>
          <select id="stk-val" className="input" value={validator ?? ""} onChange={(e) => setValidator(e.target.value || undefined)}>
            <option value="">Choose a validator</option>
            {validators.data?.map((v) => (
              <option key={v.operator} value={v.operator} disabled={v.jailed}>
                {v.moniker}, {(v.commission * 100).toFixed(0)}% commission{v.jailed ? " (jailed)" : ""}
              </option>
            ))}
          </select>
          <label className="label" htmlFor={ids.amt}>
            Amount (QOR)
          </label>
          <input id={ids.amt} className="input fig" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          <p className="hint">Available: {pos ? q(pos.liquid) : "…"}</p>
          <button className="btn" type="button" disabled={!validator || !parseAmount(amount, 6).ok} onClick={prepareDelegate}>
            Review stake
          </button>

          <h2>Lock for a bonus</h2>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Term</legend>
            <div className="seg">
              {LOCK_TERMS.map((t) => {
                const bonus = p?.tiers.find((x) => x.months === t.months)?.bonusBps;
                return (
                  <span key={t.months}>
                    <input type="radio" name="lock-term" id={`lock-${t.months}`} checked={months === t.months} onChange={() => setMonths(t.months)} />
                    <label htmlFor={`lock-${t.months}`}>
                      {t.label}
                      {bonus !== undefined ? ` +${(bonus / 100).toFixed(1)}%` : ""}
                    </label>
                  </span>
                );
              })}
            </div>
          </fieldset>
          <label className="label" htmlFor="lock-val">
            From your stake with
          </label>
          <select id="lock-val" className="input" value={lockVal ?? ""} onChange={(e) => setLockVal(e.target.value || undefined)}>
            <option value="">Choose a validator you stake with</option>
            {pos?.delegations.map((d) => (
              <option key={d.validator} value={d.validator}>
                {validators.data?.find((v) => v.operator === d.validator)?.moniker ?? d.validator}, {q(d.amount)} staked
              </option>
            ))}
          </select>
          <label className="label" htmlFor={ids.lockAmt}>
            Amount to lock (minimum {p ? q(p.minLock) : "10 QOR"})
          </label>
          <input id={ids.lockAmt} className="input fig" inputMode="decimal" value={lockAmount} onChange={(e) => setLockAmount(e.target.value)} placeholder="10" />
          <button className="btn" type="button" disabled={!lockVal || !parseAmount(lockAmount, 6).ok} onClick={prepareLock}>
            Review lock
          </button>
          {delegator && (
            <p className="hint">
              Your referral link: <span className="mono">{`${window.location.origin}/?ref=${delegator}`}</span>. People who stake through it are counted on your Portfolio. No commission is paid.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
