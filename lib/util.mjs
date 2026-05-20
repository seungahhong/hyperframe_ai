// 공통 유틸: 외부 명령 실행, 오디오 길이 측정, 슬러그/이스케이프.
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile as _execFile } from "node:child_process";

const execFile = promisify(_execFile);

/**
 * 외부 명령을 실행하고 stdout/stderr를 그대로 흘려보낸다(긴 작업용).
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(0)
        : reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`)),
    );
  });
}

/**
 * 출력을 캡처해서 돌려주는 실행기(짧은 명령용).
 */
export async function capture(cmd, args, opts = {}) {
  const { stdout } = await execFile(cmd, args, {
    maxBuffer: 1024 * 1024 * 64,
    ...opts,
  });
  return stdout;
}

/**
 * ffprobe로 오디오/영상 길이(초)를 측정한다.
 */
export async function mediaDuration(file) {
  const out = await capture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = parseFloat(String(out).trim());
  if (!Number.isFinite(d)) throw new Error(`길이 측정 실패: ${file}`);
  return d;
}

/** 파일명/폴더명용 슬러그(한글 → 로마자 대신 안전 토큰). */
export function slugify(s) {
  const base = String(s)
    .toLowerCase()
    .replace(/[^\w가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[가-힣]+/g, (m) => `kr${m.length}`); // 한글은 길이 토큰으로 치환
  return (base || "project").slice(0, 48);
}

/** HTML 텍스트 노드 이스케이프. */
export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** JS 문자열 리터럴로 안전하게 직렬화. */
export function jsString(s) {
  return JSON.stringify(String(s));
}

/** 소수 둘째자리 반올림(타임라인 정밀도). */
export function round2(n) {
  return Math.round(n * 100) / 100;
}
