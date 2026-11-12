// Writes brand/preview.html (all three directions side by side) and brand/directions/*.svg.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTIONS, wordmark } from "./marks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..");
mkdirSync(join(out, "directions"), { recursive: true });

const critiquePath = join(here, "critique.json");
const critique = existsSync(critiquePath) ? JSON.parse(readFileSync(critiquePath, "utf8")) : {};

let n = 0;
const sym = (d) => d.symbol("var(--mark-accent)", `${d.slug}${n++}`);

for (const d of DIRECTIONS) {
  writeFileSync(join(out, "directions", `${d.slug}-symbol.svg`), d.symbol("#B4483B", d.slug).trim() + "\n");
  writeFileSync(join(out, "directions", `${d.slug}-wordmark.svg`), wordmark(d.slug).trim() + "\n");
}

const sizes = [16, 32, 48, 96];
const card = (d) => {
  const c = critique[d.slug];
  return `
  <article class="direction" aria-labelledby="h-${d.slug}">
    <h2 id="h-${d.slug}">${d.name}</h2>
    <p class="idea">${d.idea}</p>
    <div class="grounds">
      ${["paper", "board"]
        .map(
          (g) => `
      <figure class="ground ground--${g}">
        <div class="lockup">
          <span class="lockup__mark">${sym(d)}</span>
          <span class="lockup__word">${wordmark(d.slug)}</span>
        </div>
        <div class="sizes">
          ${sizes.map((s) => `<span class="size" style="--s:${s}px">${sym(d)}<span class="size__px">${s}px</span></span>`).join("")}
        </div>
        <figcaption>${g === "paper" ? "On paper" : "On the ink board"}</figcaption>
      </figure>`,
        )
        .join("")}
    </div>
    <p class="word-note">${d.word}</p>
    ${
      c
        ? `<section class="critique" aria-label="Critique of ${d.name}">
      <h3>Critique</h3>
      <dl>
        <div><dt>Works</dt><dd>${c.works}</dd></div>
        <div><dt>Risks</dt><dd>${c.risks}</dd></div>
        <div><dt>At 16px</dt><dd>${c.small}</dd></div>
        <div><dt>Scores</dt><dd><ul class="scores">${c.score.map((x) => `<li>${x}</li>`).join("")}</ul></dd></div>
      </dl>
    </section>`
        : ""
    }
  </article>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qrow logo directions</title>
<meta name="description" content="Three logo directions for Qrow, a post-quantum escrow payments app, shown at real sizes on light and dark grounds.">
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
<style>
/* Hallmark · v2.0.0 · theme: coral (dealt 1/3, seed qrow-austere-calm-trustworthy-62da·feb5c929·2026-11-12·r0) · scope: component (brand review sheet) · genre: modern-minimal · tone: austere · signature: the three marks at 16px on paper and board */
/* waive 26b: the sheet has no controls, so there is nothing to give an :active state */
/* waive cream-palette (impeccable detector): the warm paper is the dealt Coral theme, not a default */
/* critique: a review sheet, not a page; one idea per direction, marks shown at real sizes on both grounds, no invented facts */
:root {
  --color-paper: oklch(97% 0.006 55);
  --color-paper-2: oklch(94.5% 0.007 55);
  --color-ink: oklch(21% 0.012 38);
  --color-muted: oklch(47% 0.013 45);
  --color-rule: oklch(87% 0.009 55);
  --color-board: oklch(22% 0.011 40);
  --color-board-type: oklch(96.5% 0.006 70);
  --color-board-muted: oklch(78% 0.01 60);
  --color-accent-light: oklch(54% 0.165 29);
  --color-accent-dark: oklch(74% 0.125 30);
  --color-focus: oklch(54% 0.17 30);
  --font-body: "General Sans", ui-sans-serif, system-ui, sans-serif;
  --radius-card: 8px;
  --space-xs: 4px; --space-sm: 8px; --space-md: 16px; --space-lg: 24px; --space-xl: 40px; --space-2xl: 64px;
  --text-sm: 0.875rem; --text-base: 1rem; --text-title: 1.375rem; --text-display: clamp(2rem, 4vw, 3rem);
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
body { margin: 0; background: var(--color-paper); color: var(--color-ink); font-family: var(--font-body); font-size: var(--text-base); line-height: 1.5; }
.wrap { max-width: 1200px; margin: 0 auto; padding: var(--space-2xl) var(--space-lg); }
h1 { font-size: var(--text-display); font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; margin: 0 0 var(--space-sm); overflow-wrap: break-word; min-width: 0; text-wrap: balance; }
.lede { color: var(--color-muted); margin: 0 0 var(--space-xl); max-width: 60ch; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: var(--space-lg); }
.direction { display: flex; flex-direction: column; gap: var(--space-md); min-width: 0; }
h2 { text-wrap: balance; font-size: var(--text-title); font-weight: 600; letter-spacing: -0.02em; margin: 0; }
h3 { font-size: var(--text-base); font-weight: 600; margin: 0 0 var(--space-sm); }
.idea, .word-note { margin: 0; color: var(--color-muted); }
.grounds { display: grid; gap: var(--space-sm); }
.ground { margin: 0; border-radius: var(--radius-card); padding: var(--space-lg); display: grid; gap: var(--space-lg); }
.ground--paper { background: var(--color-paper-2); color: var(--color-ink); --mark-accent: var(--color-accent-light); box-shadow: inset 0 0 0 1px var(--color-rule); }
.ground--board { background: var(--color-board); color: var(--color-board-type); --mark-accent: var(--color-accent-dark); }
.ground figcaption { font-size: var(--text-sm); color: var(--color-muted); }
.ground--board figcaption, .ground--board .size__px { color: var(--color-board-muted); }
.lockup { display: flex; align-items: center; gap: 12px; height: 56px; }
.lockup__mark svg { width: 56px; height: 56px; display: block; }
.lockup__word svg { height: 44px; width: auto; display: block; }
.sizes { display: flex; align-items: flex-end; gap: var(--space-lg); flex-wrap: wrap; }
.size { display: inline-flex; flex-direction: column; align-items: center; gap: var(--space-xs); }
.size svg { width: var(--s); height: var(--s); display: block; }
.size__px { font-size: var(--text-sm); color: var(--color-muted); }
.critique { border-top: 1px solid var(--color-rule); padding-top: var(--space-md); }
.critique dl { margin: 0; display: grid; gap: var(--space-sm); }
.critique dt { font-weight: 600; font-size: var(--text-sm); }
.critique dd { margin: 0; color: var(--color-muted); }
.scores { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-xs) var(--space-md); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }
</style>
</head>
<body>
<main class="wrap">
  <h1>Qrow, three directions</h1>
  <p class="lede">Each mark is shown as a lockup and at 16, 32, 48 and 96 pixels, on paper and on the ink board. Coral marks the one element that stands for the payment.</p>
  <div class="grid">
    ${DIRECTIONS.map(card).join("\n")}
  </div>
</main>
</body>
</html>
`;
writeFileSync(join(out, "preview.html"), html);
console.log("wrote brand/preview.html and brand/directions/*.svg");
