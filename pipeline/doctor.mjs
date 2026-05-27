#!/usr/bin/env node
// 환경 점검: 영상 제작에 필요한 도구들이 준비됐는지 확인.
import { execFile as _e } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const execFile = promisify(_e);

async function check(name, cmd, args, { optional = false } = {}) {
  try {
    const { stdout } = await execFile(cmd, args);
    return { name, ok: true, optional, info: String(stdout).split("\n")[0].trim() };
  } catch {
    return { name, ok: false, optional, info: "미설치/실행 불가" };
  }
}
async function checkPath(name, p, { optional = false } = {}) {
  try { await access(p); return { name, ok: true, optional, info: p }; }
  catch { return { name, ok: false, optional, info: `없음: ${p}` }; }
}

const xttsVenv = process.env.HF_XTTS_VENV || join(homedir(), ".cache/hyperframe-ai/xtts-venv");

const checks = await Promise.all([
  check("Node", "node", ["--version"]),
  check("FFmpeg", "ffmpeg", ["-version"]),
  check("ffprobe", "ffprobe", ["-version"]),
  check("macOS say (한국어 TTS)", "say", ["-v", "?"]),
  check("uvx (yt-dlp 런처)", "uvx", ["--version"]),
  check("deno (유튜브 JS 런타임)", "deno", ["--version"]),
  // 선택: 자연 한국어 TTS(Coqui XTTS-v2) venv. HF_TTS_BACKEND=xtts 사용 시 필요.
  checkPath("XTTS venv (자연 한국어 TTS, 선택)", join(xttsVenv, "bin/python"), { optional: true }),
  // Ollama 서버 (선택). 떠 있으면 summarize 가 자동으로 사용.
  checkOllama(),
]);

async function checkOllama() {
  try {
    const res = await fetch(process.env.HF_OLLAMA_URL || "http://localhost:11434/api/tags");
    if (!res.ok) throw new Error();
    const d = await res.json();
    const want = (process.env.HF_OLLAMA_MODEL || "gemma4:26b").trim();
    const has = (d.models || []).some((m) => m.name === want);
    return {
      name: "Ollama (로컬 LLM 요약, 선택)",
      ok: has,
      optional: true,
      info: has ? `${want} 사용 가능` : `서버는 떴으나 ${want} 없음 (ollama pull ${want})`,
    };
  } catch {
    return { name: "Ollama (로컬 LLM 요약, 선택)", ok: false, optional: true, info: "서버 미응답 (ollama serve)" };
  }
}

let requiredOk = true;
for (const c of checks) {
  const mark = c.ok ? "✅" : (c.optional ? "⚠️ " : "❌");
  if (!c.ok && !c.optional) requiredOk = false;
  console.log(`${mark}  ${c.name.padEnd(32)} ${c.info}`);
}
console.log(
  requiredOk
    ? "\n필수 도구 준비 완료. `npm run make -- --type srt --file ...` 로 시작하세요." +
      "\n(XTTS는 선택 — 자연 한국어 음성을 원하면 `bash lib/xtts/setup.sh` 후 HF_TTS_BACKEND=xtts)"
    : "\n일부 필수 도구가 없습니다. README의 환경 설치 섹션을 확인하세요.",
);
process.exit(requiredOk ? 0 : 1);
