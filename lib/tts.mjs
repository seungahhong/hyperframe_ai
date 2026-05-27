// 교체 가능한 TTS 계층.
//  - 한국어(ko) 기본: `edge` (Microsoft Edge TTS, 무료·자연 Neural 음성)
//  - 폴백: `say -v Yuna` (오프라인) / 별도 `xtts` (Coqui XTTS-v2, 오프라인 다운로드)
//  - 그 외(en/ja/zh 등): HyperFrames 내장 `tts`(Kokoro-82M)
//  - 강제 지정: `HF_TTS_BACKEND=edge|say|kokoro|xtts`
//  - XTTS 사용 시: lib/xtts/setup.sh 로 venv·의존성 일회 셋업
import { writeFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { run, capture, mediaDuration } from "./util.mjs";

const XTTS_VENV = process.env.HF_XTTS_VENV || join(homedir(), ".cache/hyperframe-ai/xtts-venv");
const XTTS_WRAPPER = new URL("./xtts/synth.py", import.meta.url).pathname;

// 언어별 기본 보이스
const SAY_VOICE = { ko: "Yuna", en: "Samantha", ja: "Kyoko", zh: "Tingting" };
const KOKORO_VOICE = {
  en: "af_heart",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
  es: "ef_dora",
  fr: "ff_siwis",
};
// Edge TTS Neural 음성(여성 친근 톤 기본). HF_EDGE_VOICE 또는 script.meta.voice 로 오버라이드.
const EDGE_VOICE = {
  ko: "ko-KR-SunHiNeural",
  en: "en-US-AvaMultilingualNeural",
  ja: "ja-JP-NanamiNeural",
  zh: "zh-CN-XiaoxiaoNeural",
};
// Kokoro가 지원하는 언어(한국어 미지원 → edge/say로 폴백)
const KOKORO_LANGS = new Set(["en", "ja", "zh", "es", "fr", "hi", "it", "pt"]);

export function pickBackend(lang) {
  const forced = process.env.HF_TTS_BACKEND;
  if (forced) return forced;
  // 한국어 기본을 edge(Neural)로 변경. say(Yuna) 폴백은 HF_TTS_BACKEND=say.
  if (lang === "ko") return "edge";
  return KOKORO_LANGS.has(lang) ? "kokoro" : "say";
}

/**
 * 배치 합성: 모델 로드 비용이 큰 백엔드(XTTS)를 위해 여러 라인을 한 번에 처리.
 * 비-XTTS 백엔드는 `synthLine` 을 단순 반복하는 폴백을 쓴다.
 * @param items  [{ text, outWav }]
 * @returns durations[]  각 라인 길이(초), items 와 같은 순서
 */
export async function synthLines({ items, lang = "ko", voice, rate, pitch = 1, speed = 1 }) {
  const backend = pickBackend(lang);
  if (backend === "xtts") {
    return synthXttsBatch({ items, lang, voice, speed });
  }
  // 기본: 라인별 합성 + ffmpeg/say 표준화.
  const durations = [];
  for (const it of items) {
    const d = await synthLine({ text: it.text, lang, voice, rate, pitch, speed, outWav: it.outWav });
    durations.push(d);
  }
  return durations;
}

async function synthXttsBatch({ items, lang, voice, speed }) {
  await ensureXttsVenv();
  const manifestPath = join(tmpdir(), `xtts-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const manifest = {
    language: lang,
    speaker: voice && voice !== "Yuna" ? voice : "Claribel Dervla",
    speed,
    items: items.map((it) => ({ text: it.text, output: it.outWav })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  try {
    await runPythonStream(join(XTTS_VENV, "bin/python"), [XTTS_WRAPPER, manifestPath]);
  } finally {
    await rm(manifestPath, { force: true });
  }
  // XTTS 출력은 24kHz mono. ffmpeg로 44.1k mono WAV 로 정규화 후 길이 측정.
  const durations = [];
  for (const it of items) {
    const tmpIn = it.outWav + ".xtts.wav";
    await capture("mv", [it.outWav, tmpIn]);
    await capture("ffmpeg", ["-y", "-i", tmpIn, "-ar", "44100", "-ac", "1", it.outWav]);
    await rm(tmpIn, { force: true });
    durations.push(await mediaDuration(it.outWav));
  }
  return durations;
}

async function ensureXttsVenv() {
  try {
    await access(join(XTTS_VENV, "bin/python"));
  } catch {
    throw new Error(
      `XTTS venv 가 없습니다(${XTTS_VENV}). 한 번만 셋업: bash lib/xtts/setup.sh`,
    );
  }
}

// Python 워커의 stdout(JSON 라인)을 받아 진행 상황을 콘솔에 흘리고,
// status:error 가 나오면 throw, status:ok 또는 종료 코드 0 이면 resolve.
function runPythonStream(py, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(py, args, { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    let firstError = null;
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.status === "error" && !firstError) firstError = obj.message || "xtts error";
        if (obj.event === "loading") process.stderr.write("\x1b[36m  · XTTS 모델 로드중...\x1b[0m\n");
        if (obj.event === "ready") process.stderr.write(`\x1b[36m  · XTTS ready (speaker=${obj.speaker}, ${obj.count} lines)\x1b[0m\n`);
        if (obj.event === "done") process.stderr.write(`\x1b[36m  · XTTS done ${obj.index + 1}\x1b[0m\n`);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (firstError) return reject(new Error(firstError));
      if (code === 0) resolve();
      else reject(new Error(`xtts worker exited ${code}`));
    });
  });
}

/**
 * 한 줄(text)을 합성하여 outWav(WAV, mono 44.1k)로 저장하고 길이(초)를 반환.
 * @param rate  say 음성의 분당 단어수(wpm). 낮을수록 천천히/부드럽게. 미지정 시 기본값.
 */
export async function synthLine({ text, lang = "ko", voice, outWav, speed = 1, rate, pitch = 1 }) {
  const backend = pickBackend(lang);
  if (backend === "say") {
    return synthSay({ text, voice: voice || SAY_VOICE[lang] || "Samantha", outWav, speed, rate, pitch });
  }
  if (backend === "edge") {
    return synthEdge({ text, lang, voice, outWav, rate, pitch });
  }
  return synthKokoro({
    text,
    voice: voice || KOKORO_VOICE[lang] || "af_heart",
    lang,
    outWav,
    speed,
  });
}

// Microsoft Edge TTS (온라인 무료, 고품질 Neural 음성).
// rate/pitch 매핑:
//  - 자연스러운 기준 wpm=165, pitch=1.0
//  - rate: ((wpm/165) - 1)*100 → "+%/-%" 형태로 전달 (예: 150wpm → -9%)
//  - pitch: (pitch - 1)*50Hz → "+/-Hz" (예: 0.90 → -5Hz)
async function synthEdge({ text, lang, voice, outWav, rate, pitch = 1 }) {
  const v = voice && voice.includes("Neural") ? voice : (process.env.HF_EDGE_VOICE || EDGE_VOICE[lang] || "en-US-AvaMultilingualNeural");
  const wpm = rate || 165;
  const ratePct = Math.max(-50, Math.min(50, Math.round((wpm / 165 - 1) * 100)));
  const pitchHz = Math.max(-50, Math.min(50, Math.round((pitch - 1) * 50)));
  const rateArg = (ratePct >= 0 ? "+" : "") + ratePct + "%";
  const pitchArg = (pitchHz >= 0 ? "+" : "") + pitchHz + "Hz";
  const mp3 = outWav + ".edge.mp3";
  // argparse 가 "-9%" 같은 음수 값을 새 플래그로 오인하지 않도록 `--옵션=값` 한 토큰으로 전달.
  // Microsoft Bing TTS 서버가 일시적으로 503 / 핸드셰이크 실패를 반환할 수 있어 짧은 백오프로 재시도.
  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      await run("uvx", [
        "--from", "edge-tts",
        "edge-tts",
        "--voice=" + v,
        "--rate=" + rateArg,
        "--pitch=" + pitchArg,
        "--text", text,
        "--write-media", mp3,
      ]);
      break;
    } catch (e) {
      if (attempt === MAX_TRIES) throw e;
      const wait = attempt * 1500;
      process.stderr.write(`\x1b[33m  · edge-tts 일시 오류, ${wait}ms 후 재시도 (${attempt}/${MAX_TRIES - 1})\x1b[0m\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // MP3 → WAV(44.1k mono)
  await capture("ffmpeg", ["-y", "-i", mp3, "-ar", "44100", "-ac", "1", outWav]);
  await rm(mp3, { force: true });
  return mediaDuration(outWav);
}

async function synthSay({ text, voice, outWav, speed, rate, pitch = 1 }) {
  const tmp = join(tmpdir(), `hfsay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
  const txt = join(tmp, "in.txt");
  const aiff = join(tmp, "out.aiff");
  await writeFile(txt, text, "utf8");
  // say는 분당 단어수(-r)로 속도 제어. 기본 165wpm(차분/부드러운 톤). rate 지정 시 우선.
  const wpm = rate ? Math.round(rate) : Math.round(165 * speed);
  await capture("say", ["-v", voice, "-r", String(wpm), "-o", aiff, "-f", txt]);
  // AIFF → WAV(mono 44.1k). pitch<1 이면 톤을 낮춰(따뜻하게) 기계적인 느낌을 줄인다.
  // asetrate로 피치를 내리고 atempo로 길이를 원복(피치만 변경).
  let af = "aresample=44100";
  if (pitch && pitch !== 1) {
    const SR = 22050; // say(Yuna) 출력 레이트
    af = `asetrate=${Math.round(SR * pitch)},atempo=${(1 / pitch).toFixed(4)},aresample=44100`;
  }
  await capture("ffmpeg", ["-y", "-i", aiff, "-af", af, "-ac", "1", "-ar", "44100", outWav]);
  await rm(tmp, { recursive: true, force: true });
  return mediaDuration(outWav);
}

async function synthKokoro({ text, voice, lang, outWav, speed }) {
  const hfLang = { en: "en-us", ja: "ja", zh: "zh", es: "es", fr: "fr-fr", hi: "hi", it: "it", pt: "pt-br" }[lang] || "en-us";
  const tmp = join(tmpdir(), `hfk-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await run("npx", [
    "-y",
    "hyperframes@0.6.29",
    "tts",
    text,
    "-o",
    tmp,
    "-v",
    voice,
    "-l",
    hfLang,
    "-s",
    String(speed),
  ]);
  // 샘플레이트 정규화
  await capture("ffmpeg", ["-y", "-i", tmp, "-ar", "44100", "-ac", "1", outWav]);
  await rm(tmp, { force: true });
  return mediaDuration(outWav);
}
