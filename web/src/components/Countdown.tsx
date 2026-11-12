import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatLeft(seconds: number): string {
  if (seconds <= 0) return "ended";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A live countdown to a deadline, with the exact time for screen readers and on hover. */
export function Countdown({ deadline, now }: { deadline: number; now: number }) {
  const left = deadline - now;
  const when = fmt.format(new Date(deadline * 1000));
  return (
    <span className={`fig countdown${left <= 86_400 && left > 0 ? " countdown--soon" : ""}`} title={when}>
      {left > 0 ? formatLeft(left) : "ended"}
      <span className="visually-hidden"> (until {when})</span>
    </span>
  );
}
