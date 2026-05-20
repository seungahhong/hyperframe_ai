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
 */
export async function synthLine({ text, lang = "ko", voice, outWav, speed = 1 }) {
  const backend = pickBackend(lang);
  if (backend === "say") {
    return synthSay({ text, voice: voice || SAY_VOICE[lang] || "Samantha", outWav, speed });
  }
  return synthKokoro({
    text,
    voice: voice || KOKORO_VOICE[lang] || "af_heart",
    lang,
    outWav,
    speed,
  });
}

async function synthSay({ text, voice, outWav, speed }) {
  const tmp = join(tmpdir(), `hfsay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
  const txt = join(tmp, "in.txt");
  const aiff = join(tmp, "out.aiff");
  await writeFile(txt, text, "utf8");
  // say는 분당 단어수(-r)로 속도 제어. 한국어 기본 ~180wpm 가정.
  const rate = Math.round(180 * speed);
  await capture("say", ["-v", voice, "-r", String(rate), "-o", aiff, "-f", txt]);
  // AIFF → WAV(mono 44.1k)로 정규화
  await capture("ffmpeg", ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", outWav]);
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
