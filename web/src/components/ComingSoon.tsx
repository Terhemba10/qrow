import { Link } from "react-router-dom";
import { TABS, isLive, type TabId } from "../config/tabs";

/** A tab that isn't live in the public beta yet. Links only to tabs that are live. */
export function ComingSoon({ id }: { id: TabId }) {
  const t = TABS.find((x) => x.id === id)!;
  const liveTabs = TABS.filter((x) => isLive(x.id));
  return (
    <section className="sheet" aria-labelledby="soon-title">
      <div className="sheet__head">
        <h1 id="soon-title">{t.label}</h1>
        <p className="muted">{t.blurb}</p>
      </div>
      <div className="panel empty">
        <h2>Coming soon in the public beta</h2>
        <p className="muted">
          This tab is built and goes live as soon as it works end to end with a normal QoreX wallet. We only switch on what works.
          {liveTabs.length > 0 && " Meanwhile, you can try:"}
        </p>
        <div className="row">
          {liveTabs.map((x) => (
            <Link key={x.id} className="btn btn--quiet" to={x.path}>
              {x.label}
            </Link>
          ))}
          <Link className="btn" to="/">
            Start
          </Link>
        </div>
      </div>
    </section>
  );
}
