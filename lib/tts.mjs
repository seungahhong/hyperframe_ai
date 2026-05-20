// 교체 가능한 TTS 계층.
//  - 한국어(ko): macOS `say` (Yuna) — 무료·오프라인·한글 지원
//  - 그 외(en/ja/zh 등): HyperFrames 내장 `tts`(Kokoro-82M)
//  - 환경변수 HF_TTS_BACKEND 로 강제 지정 가능 (say | kokoro)
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, capture, mediaDuration } from "./util.mjs";

// 언어별 기본 보이스
const SAY_VOICE = { ko: "Yuna", en: "Samantha", ja: "Kyoko", zh: "Tingting" };
const KOKORO_VOICE = {
  en: "af_heart",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
  es: "ef_dora",
  fr: "ff_siwis",
};
// Kokoro가 지원하는 언어(한국어 미지원 → say로 폴백)
const KOKORO_LANGS = new Set(["en", "ja", "zh", "es", "fr", "hi", "it", "pt"]);

export function pickBackend(lang) {
  const forced = process.env.HF_TTS_BACKEND;
  if (forced) return forced;
  if (lang === "ko") return "say";
  return KOKORO_LANGS.has(lang) ? "kokoro" : "say";
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
  return synthKokoro({
    text,
    voice: voice || KOKORO_VOICE[lang] || "af_heart",
    lang,
    outWav,
    speed,
  });
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
