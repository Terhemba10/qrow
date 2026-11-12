import { Link } from "react-router-dom";
import { Readiness } from "../components/Readiness";
import { TABS, isLive } from "../config/tabs";

export function StartPage() {
  return (
    <section className="page" aria-labelledby="start-title">
      <div className="sheet__head">
        <h1 id="start-title">Payments that stay safe after Q-Day</h1>
        <p className="muted">Escrow payments on QoreChain, every step signed with a quantum-safe key.</p>
      </div>
      <Readiness />
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
        </ul>
        <p className="hint">
          New here? Read <Link to="/how-to-test">How to test Qrow</Link>. Qrow stores nothing about you: see <Link to="/privacy">Privacy and testnet</Link>.
        </p>
      </section>
    </section>
  );
}
