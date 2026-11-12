// Exports the chosen direction (B. Return): SVGs, PNGs, favicon.ico, featured image.
// Run: node brand/src/export.mjs   (needs brand/fonts/*.otf locally for the featured image;
// General Sans is ITF Free Font License: usable in images, not redistributable, so it is git-ignored).
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { returnPath } from "./marks.mjs";
import { TOKENS, hex } from "./tokens.mjs";

const require = createRequire(import.meta.url);
const { Resvg } = require("../node_modules/@resvg/resvg-js");

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "export");
mkdirSync(OUT, { recursive: true });

const INK = hex(TOKENS.ink);
const PAPER = hex(TOKENS.paper);
const BOARD = hex(TOKENS.board);
const BOARD_TYPE = hex(TOKENS.boardType);

// Stroke weight per use: the 16/32px build is heavier so the ring stays open at one pixel per unit/2.
const STROKE = { regular: 3.4, small: 4.1 };

const markSvg = ({ color, stroke = STROKE.regular, bg, radius = 0, pad = 0, size = 32 }) => {
  const s = 32 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-pad} ${-pad} ${s} ${s}" role="img" aria-label="Qrow">${
    bg ? `<rect x="${-pad}" y="${-pad}" width="${s}" height="${s}" rx="${radius}" fill="${bg}"/>` : ""
  }<path d="${returnPath}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/></svg>`;
};

// Lockup: the symbol is the capital Q, then "row" in the same round monoline.
const ROW = `<path d="M21.2 24V9.9M21.2 16.2c0-4.4 2.7-6.3 6.9-6.3"/><circle cx="38.1" cy="16" r="6.3"/><path d="M48.2 9.9 52.6 22.3 57.3 11.4 62 22.3 66.4 9.9"/>`;
const lockupInner = (color) =>
  `<g transform="translate(-1.5 -1.4) scale(1.02)"><path d="${returnPath}" fill="none" stroke="${color}" stroke-width="3.3" stroke-linejoin="round"/></g>` +
  `<g transform="translate(9.6 0)" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${ROW}</g>`;
const lockupSvg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 32" role="img" aria-label="Qrow">${lockupInner(color)}</svg>`;

const png = (svg, width, opts = {}) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, ...opts }).render().asPng();

const write = (name, data) => {
  writeFileSync(join(OUT, name), data);
  console.log(`  ${name}`);
};

// ---------------------------------------------------------------- vector
write("logo.svg", lockupSvg(INK) + "\n");
write("logo-on-dark.svg", lockupSvg(PAPER) + "\n");
write("logo-mark.svg", markSvg({ color: INK }) + "\n");
write("logo-mark-on-dark.svg", markSvg({ color: PAPER }) + "\n");
// Browser-tab icon that follows the OS theme.
write(
  "favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>path{stroke:${INK}}@media (prefers-color-scheme:dark){path{stroke:${PAPER}}}</style><path d="${returnPath}" fill="none" stroke-width="${STROKE.small}" stroke-linejoin="round"/></svg>\n`,
);

// ---------------------------------------------------------------- raster
// Small sizes: ink mark on a paper tile, so the tab icon reads on light and dark browser chrome.
const tile = (size) =>
  markSvg({ color: INK, stroke: STROKE.small, bg: PAPER, radius: 7, pad: 1.5, size });
// Touch / app icons: paper mark on the ink board, inside the 80% maskable safe zone.
const appIcon = (size) => markSvg({ color: BOARD_TYPE, stroke: STROKE.regular, bg: BOARD, radius: 0, pad: 8, size });

const ico = {};
for (const s of [16, 32, 48]) {
  ico[s] = png(tile(s), s);
  if (s !== 48) write(`favicon-${s}.png`, ico[s]);
}
write("apple-touch-icon-180.png", png(appIcon(180), 180));
write("icon-192.png", png(appIcon(192), 192));
write("icon-512.png", png(appIcon(512), 512));
write("logo-mark-512.png", png(markSvg({ color: INK, size: 512 }), 512));

// favicon.ico with embedded PNGs (16, 32, 48).
{
  const sizes = [16, 32, 48];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = [];
  for (const s of sizes) {
    const e = Buffer.alloc(16);
    e.writeUInt8(s === 256 ? 0 : s, 0);
    e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(ico[s].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += ico[s].length;
    entries.push(e);
  }
  write("favicon.ico", Buffer.concat([header, ...entries, ...sizes.map((s) => ico[s])]));
}

// ---------------------------------------------------------------- featured image 1200×630
const fontDir = join(here, "..", "fonts");
const fontFiles = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => /\.(otf|ttf)$/.test(f)).map((f) => join(fontDir, f)) : [];
if (fontFiles.length === 0) {
  console.log("  (skipped featured.png: put General Sans .otf files in brand/fonts/)");
} else {
  const W = 1200;
  const H = 630;
  const M = 96; // margin
  const featured = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="light" cx="0" cy="0.3" r="1.1">
      <stop offset="0" stop-color="${hex(TOKENS.cotton)}"/>
      <stop offset="0.62" stop-color="${hex(TOKENS.desk)}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#light)"/>
  <g transform="translate(${M} ${M}) scale(2.6)">${lockupInner(INK)}</g>
  <g transform="translate(${W - M - 222} ${M - 24}) scale(7.2)"><path d="${returnPath}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/></g>
  <text x="${M}" y="${H - M - 96}" font-family="General Sans" font-weight="600" font-size="68" letter-spacing="-2" fill="${INK}">Held safely until it is claimed.</text>
  <text x="${M}" y="${H - M - 30}" font-family="General Sans" font-weight="400" font-size="30" fill="${hex(TOKENS.muted)}">Escrow payments on QoreChain. Unclaimed after 7 days, it comes back to you.</text>
</svg>`;
  write(
    "featured-1200x630.png",
    png(featured, W, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "General Sans" } }),
  );
}
console.log("done → brand/export/");
