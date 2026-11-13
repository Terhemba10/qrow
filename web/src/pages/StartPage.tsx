import { Link } from "react-router-dom";
import { TABS, isLive } from "../config/tabs";

/** Start: what Qrow is and what you can try. No checklist: tabs work as soon as QoreX is connected. */
export function StartPage() {
  return (
    <section className="page" aria-labelledby="start-title">
      <div className="sheet__head">
        <h1 id="start-title">Payments that stay safe after Q-Day</h1>
        <p className="muted">Escrow payments on QoreChain testnet, every step signed with a quantum-safe key.</p>
      </div>
      <section className="stack" aria-labelledby="try-title">
        <h2 id="try-title">What you can try</h2>
        <ul className="trylist">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link to={t.path}>{t.label}</Link>
              {!isLive(t.id) && <span className="badge">Coming soon</span>}
              <p className="hint">{t.blurb}</p>
            </li>
          ))}
          <li>
            <Link to="/verify">Verify</Link>
            <p className="hint">Check any transaction hash or Qrow reference against QoreChain testnet. No wallet needed.</p>
          </li>
        </ul>
      </section>
    </section>
  );
}
