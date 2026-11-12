// Qrow brand colours (from the Hallmark Coral theme), in OKLCH, with an sRGB hex converter.
export const TOKENS = {
  paper: [97, 0.006, 55],
  paper2: [94.5, 0.007, 55],
  paper3: [91.5, 0.009, 55],
  cotton: [98.8, 0.0045, 80],
  desk: [94.3, 0.008, 64],
  ink: [21, 0.012, 38],
  ink2: [29, 0.013, 40],
  muted: [47, 0.013, 45],
  rule: [87, 0.009, 55],
  rule2: [81, 0.011, 55],
  board: [22, 0.011, 40],
  boardType: [96.5, 0.006, 70],
  coral: [74, 0.125, 30],
  coralDeep: [54, 0.165, 29],
  settled: [55.5, 0.15, 33],
};

// OKLCH (L in %, C, h in degrees) -> #rrggbb, clamped to sRGB.
export function hex([L, C, h]) {
  const l = L / 100;
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = (x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return "#" + lin.map((x) => Math.round(enc(x) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
