import type { Explanation as Ex } from "../agent/explain";

const WHY: Record<Exclude<Ex, { ok: true }>["reason"], string> = {
  no_key: "the AI summary is turned off on this server",
  timeout: "the AI summary took too long",
  rate_limited: "the AI service is busy",
  refused: "the AI service declined to summarise",
  error: "the AI service had a problem",
  offline: "the summary service isn’t reachable",
};

/** The one AI output in the send flow: a plain-language reading of checks that already ran. */
export function Explanation({ state }: { state: { pending: true } | { pending: false; ex: Ex } }) {
  if (state.pending) {
    return (
      <section className="explain" aria-busy="true" aria-label="Summary in plain words">
        <p className="label">In plain words</p>
        <span className="skeleton" style={{ width: "92%" }} />
        <span className="skeleton" style={{ width: "70%" }} />
      </section>
    );
  }
  const { ex } = state;
  if (!ex.ok) {
    return (
      <p className="hint explain--off" role="status">
        No plain-language summary this time: {WHY[ex.reason]}. Every warning above comes from Qrow’s own checks and is complete without it.
      </p>
    );
  }
  return (
    <section className="explain" aria-label="Summary in plain words">
      <p className="label">In plain words</p>
      <p className="explain__text">{ex.text}</p>
      <p className="hint">Written by AI from the checks above. It can’t change them, and it never sees the recipient’s address.</p>
    </section>
  );
}
