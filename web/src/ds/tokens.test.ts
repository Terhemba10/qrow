import { describe, expect, it } from "vitest";
import { color, contrast, textPairs } from "./tokens";

describe("design tokens meet WCAG 2.1 AA", () => {
  for (const p of textPairs) {
    it(`${p.fg} on ${p.bg} (${p.use})`, () => {
      expect(contrast(color[p.fg], color[p.bg])).toBeGreaterThanOrEqual(p.large ? 3 : 4.5);
    });
  }
  it("focus ring and borders are visible (non-text 3:1)", () => {
    for (const bg of [color.ink, color.cyan, color.orange, color.mint, color.brand, color.light])
      expect(Math.max(contrast(color.focusOuter, bg), contrast(color.focusInner, bg))).toBeGreaterThanOrEqual(3);
  });
});
