#!/usr/bin/env node
/**
 * Qrow demo video: AI voiceover with edge-tts (Microsoft Edge neural voices; free, no API key).
 * edge-tts (LGPL-3.0) lives only in video/.venv, a local video tool: it is not an app dependency.
 * The owner approved this exception to the MIT/Apache/BSD/ISC rule on 19 Nov 2026.
 *
 *   node tts.mjs voices                         list the English (US/GB) voices
 *   node tts.mjs samples [Voice1 Voice2 ...]    the opening lines in a few voices -> audio/samples/
 *   node tts.mjs shots [--voice en-US-AndrewNeural] [--rate +0%] [shot ids...]
 *                                               one clip per shot -> audio/shots/<id>.mp3, plus audio/shots/timing.json
 *   node tts.mjs captions                       captions from script.json + timing.json -> out/captions.srt
 *
 * ElevenLabs was used until its free credits ran out (19 Nov); that code is in git history (commit 34e53d7).
 * The ElevenLabs key in video/.env is left as it is and no longer read.
 *
 * Pronunciation: the voice gets each caption with script.json's phonetic spellings (Qrow -> Crow, ...);
 * captions use the real spelling, so they match the words exactly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shotList } from "./cut.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE = join(HERE, ".venv", process.platform === "win32" ? "Scripts/edge-tts.exe" : "bin/edge-tts");
const DEFAULT_VOICE = "en-US-AndrewNeural";
const script = JSON.parse(readFileSync(join(HERE, "script.json"), "utf8"));
const WPM_TARGET = 150;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** The words as the voice should say them (longest names first, whole words only). */
export function forSpeech(text) {
  const pairs = Object.entries(script.pronunciations).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [written, spoken] of pairs) out = out.replace(new RegExp(`(?<![\\w-])${written.replace(/[-]/g, "\\-")}(?![\\w-])`, "g"), spoken);
  return out;
}

function edge(args) {
  if (!existsSync(EDGE)) fail("edge-tts isn't installed. Run: .venv/Scripts/python -m pip install edge-tts");
  let r;
  for (let attempt = 1; attempt <= 4; attempt++) { // the Edge service drops a request now and then
    r = spawnSync(EDGE, args, { encoding: "utf8" });
    if (r.status === 0) return r.stdout;
    spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${1500 * attempt})`]);
  }
  fail(`edge-tts failed: ${(r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`);
}

function speak({ voice, text, rate, file }) {
  mkdirSync(dirname(file), { recursive: true });
  edge(["--voice", voice, `--rate=${rate}`, "--text", text, "--write-media", file]);
  return { seconds: duration(file) };
}

function duration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(out.trim());
}

const words = (t) => t.trim().split(/\s+/).length;

/** Mid-points of the pauses in a clip (silences of 0.18 s or more), in seconds. */
function pausesIn(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-35dB:d=0.18", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...r.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => (ends[i] !== undefined ? (s + ends[i]) / 2 : s));
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "voices") {
    console.log(edge(["--list-voices"]).split(/\r?\n/).filter((l) => /^(Name|-|en-(US|GB)-)/.test(l)).join("\n"));
    return;
  }

  if (cmd === "samples") {
    const names = rest.filter((r) => !r.startsWith("--"));
    const wanted = names.length ? names : ["en-US-AndrewNeural", "en-US-AvaNeural", "en-US-BrianNeural"];
    const opening = `${script.shots[0].caption} ${script.shots[1].caption.split(". ")[0]}.`;
    console.log(`Opening lines (${words(opening)} words):\n  "${opening}"\n`);
    for (const v of wanted) {
      const file = join(HERE, "audio", "samples", `${v}.mp3`);
      const r = speak({ voice: v, text: forSpeech(opening), rate: arg("rate", "+0%"), file });
      console.log(`  ${v.padEnd(28)} ${r.seconds.toFixed(1)} s, ${Math.round((words(opening) / r.seconds) * 60)} wpm -> ${file}`);
    }
    return;
  }

  if (cmd === "shots") {
    const voice = arg("voice", DEFAULT_VOICE);
    const rate = arg("rate", "+0%");
    const only = rest.filter((r) => !r.startsWith("--") && r !== arg("voice") && r !== arg("rate"));
    const timingFile = join(HERE, "audio", "shots", "timing.json");
    const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, "utf8")) : {};
    for (const s of script.shots) {
      if (only.length && !only.includes(s.id)) continue;
      const file = join(HERE, "audio", "shots", `${s.id}.mp3`);
      const r = speak({ voice, text: forSpeech(s.caption), rate, file });
      const wpm = Math.round((words(s.caption) / r.seconds) * 60);
      timing[s.id] = { seconds: r.seconds, wpm, scene: s.seconds, voice, engine: "edge-tts", rate };
      const fit = r.seconds + 0.6 <= s.seconds ? "fits" : "LONGER than the scene: trim or speed up the footage, never the voice";
      console.log(`${s.id.padEnd(20)} ${r.seconds.toFixed(1)} s / scene ${s.seconds} s, ${wpm} wpm (${fit})`);
      writeFileSync(timingFile, JSON.stringify(timing, null, 2)); // after every clip, so a failure keeps what was made
    }
    const total = script.shots.reduce((a, s) => a + Math.max(s.seconds, (timing[s.id]?.seconds ?? 0) + 0.6), 0);
    console.log(`\nVideo length with these clips: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} (limit 3:00). Pace target ${WPM_TARGET} wpm.`);
    return;
  }

  if (cmd === "captions") {
    const timingFile = join(HERE, "audio", "shots", "timing.json");
    if (!existsSync(timingFile)) fail("Generate the shots first: node tts.mjs shots");
    const timing = JSON.parse(readFileSync(timingFile, "utf8"));
    const LEAD = 0.3; // the voice starts 0.3 s into each scene
    let t = 0;
    let n = 1;
    const out = [];
    const ts = (x) => {
      const ms = Math.round(x * 1000);
      const p = (v, w = 2) => String(v).padStart(w, "0");
      return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
    };
    for (const s of shotList(script)) {
      const dur = timing[s.id]?.seconds;
      if (!dur) fail(`No clip for ${s.id} yet.`);
      // One caption per sentence. Each split is first estimated from the sentence's share of the
      // characters, then snapped to the nearest real pause in the clip (where the voice breathes).
      const sentences = s.caption.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map((x) => x.trim());
      const total = sentences.reduce((a, x) => a + x.length, 0);
      const pauses = pausesIn(join(HERE, "audio", "shots", `${s.id}.mp3`));
      const bounds = [0];
      let acc = 0;
      for (const sen of sentences.slice(0, -1)) {
        acc += (sen.length / total) * dur;
        const near = pauses.filter((p) => p > bounds[bounds.length - 1] + 0.5 && p < dur - 0.5).sort((a, b) => Math.abs(a - acc) - Math.abs(b - acc))[0];
        bounds.push(near !== undefined && Math.abs(near - acc) < 1.5 ? near : acc);
      }
      bounds.push(dur);
      sentences.forEach((sen, i) => {
        // Captions longer than two lines (~84 characters) split at the comma nearest the middle.
        const commas = [...sen.matchAll(/, /g)].map((m) => m.index + 1);
        const cut = sen.length > 84 && commas.length ? commas.sort((a, b) => Math.abs(a - sen.length / 2) - Math.abs(b - sen.length / 2))[0] : -1;
        const pieces = cut > 0 ? [sen.slice(0, cut).trim(), sen.slice(cut).trim()] : [sen];
        let at = bounds[i];
        const span = bounds[i + 1] - bounds[i];
        for (const p of pieces) {
          const len = (p.length / sen.length) * span;
          out.push(`${n++}\n${ts(t + LEAD + at)} --> ${ts(t + LEAD + at + len)}\n${p}\n`);
          at += len;
        }
      });
      t += Math.max(s.seconds, dur + 0.6);
    }
    mkdirSync(join(HERE, "out"), { recursive: true });
    writeFileSync(join(HERE, "out", "captions.srt"), out.join("\n"));
    console.log(`Wrote out/captions.srt (${n - 1} captions, from script.json, so they match the narration word for word).`);
    return;
  }

  console.log("Usage: node tts.mjs voices | samples [voices] | shots [--voice V] [--rate +0%] [ids] | captions");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
