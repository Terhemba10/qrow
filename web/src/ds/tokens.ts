/**
 * Qrow design system v2: the single source of the token values. `src/styles/ds.css` mirrors these as CSS variables
 * (`--q-*`), and `tokens.test.ts` checks every text/background pair against WCAG 2.1 AA.
 *
 * Direction (owner's brief): dark premium crypto dashboard in the QoreChain / QoreX family. Near-black ink with a
 * navy cast, big condensed uppercase headings, large rounded cards, cyan / orange / mint accents plus Qrow violet,
 * pill buttons, big numbers with sparklines.
 */
export const color = {
  // Surfaces, darkest to lightest
  ink: "#07080F", // page background
  surface1: "#12131D", // cards
  surface2: "#1B1D2A", // inputs, nested panels
  surface3: "#262939", // hover, selected
  line: "#2E3144", // borders, dividers
  // Text
  text: "#F3F4FA",
  muted: "#A6A9C2",
  faint: "#8A8EAD", // captions only, never under 14px on surface2
  onAccent: "#07080F", // text on cyan / orange / mint / light
  // Accents
  brand: "#9B6BFF", // Qrow violet
  brandText: "#BBA0FF", // violet used AS text on dark surfaces
  cyan: "#4FD8F7",
  orange: "#FF7A2F",
  mint: "#2FE3A0",
  light: "#F4F5FA", // the white "activity" panel
  // Status
  ok: "#2FE3A0",
  warn: "#FFD27A",
  danger: "#FF6B81",
  // Focus: dark inner + light outer ring, visible on every accent and on ink
  focusOuter: "#FFFFFF",
  focusInner: "#07080F",
} as const;

export type ColorToken = keyof typeof color;

/** Type: condensed display for headings and big numbers, General Sans for everything you read. */
export const font = {
  display: '"Big Shoulders Display", "Arial Narrow", sans-serif',
  body: '"General Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace', // addresses and hashes only
} as const;

/** Modular scale (1.25) from 16px; display sizes clamp between phone and desktop. */
export const type = {
  caption: "0.8125rem", // 13
  small: "0.875rem", // 14
  body: "1rem", // 16
  lead: "1.125rem", // 18
  title: "1.375rem", // 22
  h3: "clamp(1.5rem, 1.2rem + 1vw, 1.875rem)",
  h2: "clamp(2rem, 1.5rem + 2vw, 2.75rem)",
  h1: "clamp(2.75rem, 1.8rem + 4vw, 4.75rem)",
  stat: "clamp(2.5rem, 1.8rem + 3vw, 4rem)",
} as const;

export const space = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "24px", 6: "32px", 7: "48px", 8: "64px" } as const;
/** Radius grows with the size of the thing: chips < inputs < cards < hero cards. */
export const radius = { sm: "10px", md: "16px", lg: "24px", xl: "32px", pill: "999px" } as const;
export const shadow = {
  rest: "0 1px 0 rgb(255 255 255 / 0.04) inset",
  raised: "0 18px 40px -20px rgb(0 0 0 / 0.75)",
  sheet: "0 -24px 60px -20px rgb(0 0 0 / 0.8)",
} as const;
/** Motion: 150–250ms, purposeful only (press, success, count-up). */
export const motion = { fast: "150ms", base: "200ms", slow: "250ms", ease: "cubic-bezier(0.2, 0.8, 0.2, 1)", spring: "cubic-bezier(0.34, 1.56, 0.64, 1)" } as const;
/** Every control is at least this tall (WCAG 2.5.5). */
export const tapTarget = 44;

/** Text/background pairs the UI uses; tokens.test.ts checks each against AA. */
export const textPairs: { fg: ColorToken; bg: ColorToken; large?: boolean; use: string }[] = [
  { fg: "text", bg: "ink", use: "body on page" },
  { fg: "text", bg: "surface1", use: "body on card" },
  { fg: "text", bg: "surface2", use: "input text" },
  { fg: "text", bg: "surface3", use: "selected row" },
  { fg: "muted", bg: "ink", use: "secondary on page" },
  { fg: "muted", bg: "surface1", use: "secondary on card" },
  { fg: "muted", bg: "surface2", use: "placeholder / helper in inputs" },
  { fg: "faint", bg: "ink", use: "captions on page" },
  { fg: "faint", bg: "surface1", use: "captions on card" },
  { fg: "brandText", bg: "ink", use: "violet links on page" },
  { fg: "brandText", bg: "surface1", use: "violet links on card" },
  { fg: "cyan", bg: "ink", use: "cyan figures" },
  { fg: "mint", bg: "surface1", use: "positive PnL" },
  { fg: "orange", bg: "surface1", use: "orange figures" },
  { fg: "danger", bg: "surface1", use: "errors, negative PnL" },
  { fg: "warn", bg: "surface1", use: "warnings" },
  { fg: "onAccent", bg: "cyan", use: "button / tile on cyan" },
  { fg: "onAccent", bg: "orange", use: "button / tile on orange" },
  { fg: "onAccent", bg: "mint", use: "button / tile on mint" },
  { fg: "onAccent", bg: "light", use: "activity panel text" },
  { fg: "onAccent", bg: "brand", use: "primary button" },
  { fg: "ink", bg: "light", use: "light panel" },
];

/** WCAG 2.1 relative luminance and contrast ratio. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
