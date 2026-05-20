#!/usr/bin/env node
// 환경 점검: 영상 제작에 필요한 도구들이 준비됐는지 확인.
import { execFile as _e } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(_e);

async function check(name, cmd, args) {
  try {
    const { stdout } = await execFile(cmd, args);
    return { name, ok: true, info: String(stdout).split("\n")[0].trim() };
  } catch {
    return { name, ok: false, info: "미설치/실행 불가" };
  }
}

const checks = await Promise.all([
  check("Node", "node", ["--version"]),
  check("FFmpeg", "ffmpeg", ["-version"]),
  check("ffprobe", "ffprobe", ["-version"]),
  check("macOS say (한국어 TTS)", "say", ["-v", "?"]),
  check("uvx (yt-dlp 런처)", "uvx", ["--version"]),
]);

let allOk = true;
for (const c of checks) {
  if (!c.ok) allOk = false;
  console.log(`${c.ok ? "✅" : "❌"}  ${c.name.padEnd(26)} ${c.info}`);
}
console.log(
  allOk
    ? "\n모든 도구 준비 완료. `npm run make -- --type srt --file ...` 로 시작하세요."
    : "\n일부 도구가 없습니다. README의 환경 설치 섹션을 확인하세요.",
);
process.exit(allOk ? 0 : 1);
