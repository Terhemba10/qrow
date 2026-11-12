// Small line icons (decorative: every use sits next to words, so they are aria-hidden).
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconAlert = () => (
  <svg {...base}>
    <path d="M12 3 2.5 20h19L12 3Z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </svg>
);
export const IconStop = () => (
  <svg {...base}>
    <path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8L8 2.5Z" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </svg>
);
export const IconCheck = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m8 12.5 2.7 2.7L16 9.8" />
  </svg>
);
export const IconInfo = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </svg>
);
