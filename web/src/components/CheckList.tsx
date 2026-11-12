import type { AgentRun, CheckResult, Level } from "../agent/checks";
import { IconAlert, IconCheck, IconInfo, IconStop } from "./Icons";

const ORDER: Level[] = ["block", "danger", "warn", "info", "ok"];
const ICON: Record<Level, () => JSX.Element> = { block: IconStop, danger: IconStop, warn: IconAlert, info: IconInfo, ok: IconCheck };
const WORD: Record<Level, string> = { block: "Can’t send", danger: "Possible scam", warn: "Check", info: "Note", ok: "Passed" };

export function CheckList({ run }: { run: AgentRun }) {
  const sorted = [...run.results].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  const passed = run.results.filter((r) => r.level === "ok").length;
  return (
    <section aria-labelledby="checks-title" className="checks">
      <div className="checks__head">
        <h2 id="checks-title">Checks</h2>
        <p className="hint fig">
          {passed} of {run.results.length} passed, in {run.totalMs} ms
        </p>
      </div>
      <ul className="checks__list">
        {sorted.map((r) => (
          <CheckRow key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

function CheckRow({ r }: { r: CheckResult }) {
  const Icon = ICON[r.level];
  return (
    <li className={`check check--${r.level}`}>
      <span className="check__icon">
        <Icon />
      </span>
      <div className="check__body">
        <p className="check__title">
          <span className="visually-hidden">{WORD[r.level]}: </span>
          {r.title}
        </p>
        {r.detail && (r.level === "ok" || r.level === "info") && <p className="check__detail">{r.detail}</p>}
      </div>
      <span className="check__ms fig" aria-label={`${r.ms} milliseconds`}>
        {r.ms} ms
      </span>
    </li>
  );
}

export function CheckListSkeleton() {
  return (
    <section aria-labelledby="checks-title" className="checks" aria-busy="true">
      <div className="checks__head">
        <h2 id="checks-title">Checking this payment</h2>
        <p className="hint">Address, recipient, balance and limits, read from the testnet.</p>
      </div>
      <ul className="checks__list">
        {Array.from({ length: 6 }, (_, i) => (
          <li className="check" key={i}>
            <span className="skeleton" style={{ width: 18, height: 18, borderRadius: 999 }} />
            <span className="skeleton" style={{ width: `${40 + ((i * 13) % 40)}%` }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
