// Qrow logo directions — hand-written SVG geometry.
// Every mark uses currentColor for ink and a .accent class for the one coral element,
// so the same file works on light and dark grounds.
// Grid: symbols on a 32-unit square (favicon-friendly); wordmarks on a 24-unit x-height band.

const INK = "currentColor";

// A. Sealed
// An envelope held shut by a round seal: the payment is sealed until the recipient opens it.
// (Also a nod to QoreSeal, which encrypts the recipient's notice.)
export const sealedSymbol = (accent = INK, uid = "s") => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Qrow">
  <defs>
    <mask id="sealed-gap-${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
      <rect width="32" height="32" fill="#fff"/>
      <circle cx="16" cy="18.25" r="6.9" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#sealed-gap-${uid})" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
    <rect x="3.25" y="7.25" width="25.5" height="18" rx="3"/>
    <path d="M4.75 8.75 16 17.25 27.25 8.75"/>
  </g>
  <circle class="accent" cx="16" cy="18.25" r="4.6" fill="${accent}"/>
</svg>`;

// Rounded monoline lowercase, round caps (calm, friendly).
const roundWord = (sw = 3.4) => `
  <g fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8.3" cy="16" r="6.3"/>
    <path d="M14.6 9.7V30.5"/>
    <path d="M21.2 24V9.9M21.2 16.2c0-4.4 2.7-6.3 6.9-6.3"/>
    <circle cx="38.1" cy="16" r="6.3"/>
    <path d="M48.2 9.9 52.6 22.3 57.3 11.4 62 22.3 66.4 9.9"/>
  </g>`;

// B. Return
// One continuous stroke: a Q whose tail runs out and loops back into the ring.
// The payment goes out; if nobody claims it, it comes back.
const returnPath = "M17.09 24.16A10 10 0 1 1 24.16 17.09C25.7 20.3 27.4 24.5 28.3 27.1C28.8 28.6 27.6 29.4 26.2 28.5C23.6 26.8 20 25.4 17.09 24.16Z";
export const returnSymbol = (accent = INK) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Qrow">
  <path d="${returnPath}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
</svg>`;

// C. Lattice
// A 3×3 lattice with one cell set out: lattice maths is what ML-DSA (and Qrow's claims) stand on;
// eight cells hold, one payment moves.
const cells = [2, 10.5, 19];
export const latticeSymbol = (accent = INK) => {
  const r = [];
  for (const y of cells) for (const x of cells) {
    if (x === 19 && y === 19) continue;
    r.push(`<rect x="${x}" y="${y}" width="6" height="6" rx="1.3" fill="${INK}"/>`);
  }
  r.push(`<rect class="accent" x="24.5" y="24.5" width="6" height="6" rx="1.3" fill="${accent}"/>`);
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Qrow">
  ${r.join("\n  ")}
</svg>`;
};

// Square-cut monoline lowercase, butt caps and mitred joins (exact, austere).
const squareWord = (sw = 3.6) => `
  <g fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="butt" stroke-linejoin="miter">
    <rect x="2.2" y="9.9" width="12" height="12.2" rx="0"/>
    <path d="M14.2 8.1V31"/>
    <path d="M21.4 24V8.1M21.4 13.5c1.6-2.6 3.8-3.6 6.8-3.6"/>
    <rect x="31.8" y="9.9" width="12.2" height="12.2"/>
    <path d="M48.2 8.6 51.9 22.1 56.6 11.2 61.3 22.1 65 8.6"/>
  </g>`;

// ---------------------------------------------------------------- wordmarks and lockups
// Wordmark viewBox: x 0..70, y 4..32 (x-height band 8..24, descender to 31).
export const wordmark = (dir) => {
  if (dir === "lattice") return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 4 69 28" role="img" aria-label="Qrow">${squareWord()}</svg>`;
  if (dir === "return") {
    // Capital Q is the symbol itself, set on the cap height; then "row" in the round monoline.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 32" role="img" aria-label="Qrow">
  <g transform="translate(-1.5 -1.4) scale(1.02)"><path d="${returnPath}" fill="none" stroke="${INK}" stroke-width="3.3" stroke-linejoin="round"/></g>
  <g transform="translate(9.6 0)" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.2 24V9.9M21.2 16.2c0-4.4 2.7-6.3 6.9-6.3"/>
    <circle cx="38.1" cy="16" r="6.3"/>
    <path d="M48.2 9.9 52.6 22.3 57.3 11.4 62 22.3 66.4 9.9"/>
  </g>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 4 70 28" role="img" aria-label="Qrow">${roundWord()}</svg>`;
};

export const DIRECTIONS = [
  {
    slug: "sealed",
    name: "A. Sealed",
    idea: "An envelope held shut by a round seal. The payment stays sealed until the recipient opens it; QoreSeal carries the notice.",
    symbol: sealedSymbol,
    word: "Rounded monoline lowercase, round caps.",
  },
  {
    slug: "return",
    name: "B. Return",
    idea: "One continuous stroke: a Q whose tail runs out and loops back into the ring. It goes out; unclaimed, it comes home.",
    symbol: returnSymbol,
    word: "The symbol is the capital Q, then “row” in the same monoline.",
  },
  {
    slug: "lattice",
    name: "C. Lattice",
    idea: "A 3×3 lattice with one cell set out. ML-DSA is lattice cryptography; eight cells hold, one payment moves.",
    symbol: latticeSymbol,
    word: "Square-cut monoline lowercase, butt caps, mitred joins.",
  },
];
