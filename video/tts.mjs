#!/usr/bin/env node
/**
 * Qrow demo video: AI voiceover with ElevenLabs (plain HTTPS, no extra packages).
 * The API key is read from video/.env (git-ignored) and is never printed or logged.
 *
 *   node tts.mjs voices                         list this account's pre-made voices
 *   node tts.mjs samples [Name1 Name2 Name3]    the opening lines in 2-3 voices -> audio/samples/
 *   node tts.mjs shots --voice Name [--model eleven_v4|eleven_multilingual_v2] [--speed 1.0] [shot ids...]
 *                                               one clip per shot -> audio/shots/, plus audio/shots/timing.json
 *   node tts.mjs captions                       captions from script.json + timing.json -> out/captions.srt
 *
 * Pronunciation: the voice gets each caption with script.json's phonetic spellings (Qrow -> Crow, ...);
 * captions use the real spelling, so they match the words exactly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.elevenlabs.io/v1";
const script = JSON.parse(readFileSync(join(HERE, "script.json"), "utf8"));
const WPM_TARGET = 150;

function apiKey() {
  const file = join(HERE, ".env");
  if (!existsSync(file)) fail("No video/.env yet. Add a line ELEVENLABS_API_KEY=... to qrow/video/.env (it is git-ignored).");
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*ELEVENLABS_API_KEY\s*=/.test(l));
  const key = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  if (!key) fail("video/.env has no ELEVENLABS_API_KEY value.");
  return key;
}

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

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": apiKey(), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (res.status === 401) fail("ElevenLabs refused the key (401). Check ELEVENLABS_API_KEY in video/.env.");
    if (res.status === 402) fail(`This voice or setting needs a paid plan (402): ${body}`);
    fail(`ElevenLabs error ${res.status}: ${body}`);
  }
  return res;
}

async function premadeVoices() {
  const j = await (await call("/voices")).json();
  return j.voices.filter((v) => v.category === "premade");
}

async function resolveVoice(nameOrId) {
  const voices = await premadeVoices();
  const v = voices.find((x) => x.voice_id === nameOrId || x.name.toLowerCase().startsWith(nameOrId.toLowerCase()));
  if (!v) fail(`No pre-made voice "${nameOrId}". Run: node tts.mjs voices`);
  return v;
}

async function speak({ voiceId, text, model, speed, previous, next, file }) {
  const settings = { stability: 0.55, similarity_boost: 0.75 };
  if (model !== "eleven_v4" && speed) settings.speed = speed; // v4 has no speed setting
  const body = { text, model_id: model, voice_settings: settings, apply_text_normalization: "on", ...(previous ? { previous_text: previous } : {}), ...(next ? { next_text: next } : {}) };
  const res = await call(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { seconds: duration(file), chars: Number(res.headers.get("x-character-count") ?? text.length) };
}

function duration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(out.trim());
}

const words = (t) => t.trim().split(/\s+/).length;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "voices") {
    for (const v of await premadeVoices()) {
      const l = v.labels ?? {};
      console.log(`${v.name.padEnd(12)} ${[l.gender, l.age, l.accent, l.description ?? l.descriptive, l.use_case ?? l.use_case].filter(Boolean).join(", ")}`);
    }
    return;
  }

  if (cmd === "samples") {
    const names = rest.filter((r) => !r.startsWith("--"));
    const voices = await premadeVoices();
    // Default picks: warm, clear narrators with a neutral (American) accent, one female and two male.
    const wanted = names.length ? names : ["Sarah", "Brian", "George"];
    const opening = `${script.shots[0].caption} ${script.shots[1].caption.split(". ")[0]}.`;
    const model = arg("model", "eleven_v4");
    console.log(`Opening lines (${words(opening)} words), model ${model}:\n  "${opening}"\n`);
    for (const n of wanted) {
      const v = voices.find((x) => x.name.toLowerCase().startsWith(n.toLowerCase()));
      if (!v) {
        console.log(`  ${n}: not available on this account (run: node tts.mjs voices)`);
        continue;
      }
      const file = join(HERE, "audio", "samples", `${v.name.split(" ")[0].toLowerCase()}.mp3`);
      const r = await speak({ voiceId: v.voice_id, text: forSpeech(opening), model, file });
      const l = v.labels ?? {};
      console.log(`  ${v.name.padEnd(10)} ${[l.gender, l.accent, l.description].filter(Boolean).join(", ").padEnd(36)} ${r.seconds.toFixed(1)} s, ${Math.round((words(opening) / r.seconds) * 60)} wpm -> ${file}`);
    }
    return;
  }

  if (cmd === "shots") {
    const voiceArg = arg("voice");
    if (!voiceArg) fail("Choose the voice: node tts.mjs shots --voice <Name>");
    const v = await resolveVoice(voiceArg);
    const model = arg("model", "eleven_v4");
    const speed = arg("speed") ? Number(arg("speed")) : undefined;
    const only = rest.filter((r) => !r.startsWith("--") && r !== voiceArg && r !== arg("model") && r !== arg("speed"));
    const shots = [...script.shots, ...(script.alternates ?? [])];
    const timingFile = join(HERE, "audio", "shots", "timing.json");
    const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, "utf8")) : {};
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (only.length && !only.includes(s.id)) continue;
      const main = script.shots;
      const k = main.findIndex((x) => x.id === s.id);
      const previous = k > 0 ? forSpeech(main[k - 1].caption) : undefined;
      const next = k >= 0 && k < main.length - 1 ? forSpeech(main[k + 1].caption) : undefined;
      const file = join(HERE, "audio", "shots", `${s.id}.mp3`);
      const r = await speak({ voiceId: v.voice_id, text: forSpeech(s.caption), model, speed, previous, next, file });
      const wpm = Math.round((words(s.caption) / r.seconds) * 60);
      timing[s.id] = { seconds: r.seconds, wpm, scene: s.seconds, voice: v.name, model };
      const fit = r.seconds + 0.6 <= s.seconds ? "fits" : "LONGER than the scene: trim or speed up the footage, never the voice";
      console.log(`${s.id.padEnd(20)} ${r.seconds.toFixed(1)} s / scene ${s.seconds} s, ${wpm} wpm (${fit})`);
    }
    writeFileSync(timingFile, JSON.stringify(timing, null, 2));
    const total = script.shots.reduce((a, s) => a + Math.max(s.seconds, (timing[s.id]?.seconds ?? 0) + 0.6), 0);
    console.log(`\nVideo length with these clips: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} (limit 3:00). Pace target ${WPM_TARGET} wpm.`);
    return;
  }

  if (cmd === "captions") {
    const timingFile = join(HERE, "audio", "shots", "timing.json");
    if (!existsSync(timingFile)) fail("Generate the shots first: node tts.mjs shots --voice <Name>");
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
    for (const s of script.shots) {
      const dur = timing[s.id]?.seconds;
      if (!dur) fail(`No clip for ${s.id} yet.`);
      // One caption per sentence, timed by its share of the clip's characters.
      const sentences = s.caption.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map((x) => x.trim());
      const total = sentences.reduce((a, x) => a + x.length, 0);
      let start = t + LEAD;
      for (const sen of sentences) {
        const len = (sen.length / total) * dur;
        out.push(`${n++}\n${ts(start)} --> ${ts(start + len)}\n${sen}\n`);
        start += len;
      }
      t += Math.max(s.seconds, dur + 0.6);
    }
    mkdirSync(join(HERE, "out"), { recursive: true });
    writeFileSync(join(HERE, "out", "captions.srt"), out.join("\n"));
    console.log(`Wrote out/captions.srt (${n - 1} captions, from script.json, so they match the narration word for word).`);
    return;
  }

  console.log("Usage: node tts.mjs voices | samples [names] | shots --voice <Name> [ids] | captions");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
