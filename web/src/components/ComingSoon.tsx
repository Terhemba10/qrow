import { Link } from "react-router-dom";
import { TABS, type TabId } from "../config/tabs";

export function ComingSoon({ id }: { id: TabId }) {
  const t = TABS.find((x) => x.id === id)!;
  return (
    <section className="sheet" aria-labelledby="soon-title">
      <div className="sheet__head">
        <h1 id="soon-title">{t.label}</h1>
        <p className="muted">{t.blurb}</p>
      </div>
      <div className="panel empty">
        <h2>Coming soon in the public beta</h2>
        <p className="muted">This tab is built and goes live as soon as it passes its tests with a real QoreX wallet. Meanwhile, try sending and receiving a payment.</p>
        <Link className="btn" to="/send">
          Try Send
        </Link>
      </div>
    </section>
  );
}
