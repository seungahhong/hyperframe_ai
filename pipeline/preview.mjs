#!/usr/bin/env node
// 브라우저 미리보기: node pipeline/preview.mjs <project-name>
// (HyperFrames studio를 띄운다. 장시간 실행되는 서버이므로 백그라운드 권장.)
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
if (!name) {
  console.error("사용법: node pipeline/preview.mjs <project-name>");
  process.exit(1);
}
const projDir = join(ROOT, "projects", name);
console.log(`▶ 미리보기 서버 시작: projects/${name} (Ctrl+C 로 종료)`);
spawn("npx", ["-y", "hyperframes@0.6.29", "preview"], { cwd: projDir, stdio: "inherit" });
