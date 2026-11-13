/**
 * The video's shot list. Default: script.json's shots. With --alt (payments not live in QoreX yet):
 * s05-send is replaced by the alternate s05-alt and s06-claim is dropped. Shared by mix.mjs, tts.mjs and
 * assemble.py (which reads the same rule) so voice, captions and picture always use the same cut.
 */
export function shotList(script, alt = process.argv.includes("--alt")) {
  if (!alt) return script.shots;
  const altShot = (script.alternates ?? []).find((a) => a.id === "s05-alt");
  return script.shots.filter((s) => s.id !== "s06-claim").map((s) => (s.id === "s05-send" && altShot ? altShot : s));
}
