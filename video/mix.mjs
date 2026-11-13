#!/usr/bin/env node
/**
 * Qrow demo video: the soundtrack (voice + background music), with ffmpeg.
 *
 *   node mix.mjs preview    the three voice samples back to back over the music -> out/preview-mix.mp3
 *   node mix.mjs            the full narration (audio/shots/*.mp3 placed at each scene's start, from
 *                           timing.json) over the music -> out/soundtrack.wav, ready to lay under the footage
 *
 * Mix rules (README): the voice stays clearly on top. The music is brought down to about -30 LUFS and
 * ducked further whenever the voice speaks (sidechain compression), looped with a crossfade to the
 * video's length, faded in and out. The master is normalised for YouTube: -14 LUFS integrated, true peak
 * at most -1 dBTP, so nothing clips.
 *
 * Music: "Good Days" by Aylex, from Free To Use (freetouse.com/music), free licence: personal account,
 * non-commercial, attribution in the YouTube description (see README).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MUSIC = join(HERE, "audio", "music", "good-days-aylex.mp3");
const LEAD = 0.3; // each clip starts 0.3 s into its scene (same as the captions)
const MUSIC_LUFS = -30;
const FADE_IN = 1.5;
const FADE_OUT = 4;

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** Voice clips and where each starts (seconds), plus the total length. */
function layout(mode) {
  if (mode === "preview") {
    const files = ["bella", "eric", "river"].map((n) => join(HERE, "audio", "samples", `${n}.mp3`));
    if (!files.every(existsSync)) fail("Make the samples first: node tts.mjs samples Bella Eric River");
    let t = 1.5;
    const clips = files.map((file) => {
      const c = { file, start: t };
      t += dur(file) + 1.5;
      return c;
    });
    return { clips, total: t + 2 };
  }
  const script = JSON.parse(readFileSync(join(HERE, "script.json"), "utf8"));
  const timingFile = join(HERE, "audio", "shots", "timing.json");
  if (!existsSync(timingFile)) fail("Generate the narration first: node tts.mjs shots --voice <Name>");
  const timing = JSON.parse(readFileSync(timingFile, "utf8"));
  let t = 0;
  const clips = script.shots.map((s) => {
    const file = join(HERE, "audio", "shots", `${s.id}.mp3`);
    if (!existsSync(file) || !timing[s.id]) fail(`No clip for ${s.id} yet.`);
    const c = { file, start: t + LEAD };
    t += Math.max(s.seconds, timing[s.id].seconds + 0.6);
    return c;
  });
  return { clips, total: t };
}

function loudness(file) {
  // ffmpeg prints the ebur128 summary on stderr.
  return spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
}

function main() {
  const mode = process.argv[2] === "preview" ? "preview" : "full";
  if (!existsSync(MUSIC)) fail(`Music missing: ${MUSIC}`);
  const { clips, total } = layout(mode);
  const outDir = join(HERE, "out");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, mode === "preview" ? "preview-mix.mp3" : "soundtrack.wav");

  const musicLen = dur(MUSIC);
  // Inputs: the music twice (for a crossfaded loop when the video is longer), then the voice clips.
  const inputs = ["-i", MUSIC, "-i", MUSIC, ...clips.flatMap((c) => ["-i", c.file])];
  const parts = [];
  // Music bed: loop once with a 3 s crossfade, trim to the video, normalise low, fade in and out.
  const loop = total > musicLen - 1 ? "[0:a][1:a]acrossfade=d=3:c1=tri:c2=tri[mloop]" : "[0:a]anull[mloop]";
  parts.push(loop);
  parts.push(`[mloop]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,loudnorm=I=${MUSIC_LUFS}:TP=-6:LRA=7,afade=t=in:d=${FADE_IN},afade=t=out:st=${(total - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[bed]`);
  // Voice: each clip delayed to its start, then mixed into one track.
  clips.forEach((c, i) => {
    const ms = Math.round(c.start * 1000);
    parts.push(`[${i + 2}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
  });
  parts.push(`${clips.map((_, i) => `[v${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${total.toFixed(2)},asplit=2[voice][key]`);
  // Duck the music under the voice (about 8-10 dB more while speaking), then mix and master.
  parts.push("[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]");
  parts.push("[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1:LRA=11[mix]");

  ff([...inputs, "-filter_complex", parts.join(";"), "-map", "[mix]", "-ar", "48000", ...(mode === "preview" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", "pcm_s16le"]), "-t", total.toFixed(2), out]);
  const report = loudness(out)
    .split(/\r?\n/)
    .filter((l) => /^\s+(I:|Peak:)/.test(l))
    .map((l) => l.trim())
    .join(", ");
  console.log(`${out}\n  length ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}, ${report}`);
}

main();
