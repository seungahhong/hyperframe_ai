#!/usr/bin/env node
// 오케스트레이터: 링크/파일 → (인제스트 → 요약) → 내레이션 → 컴포지션 → 렌더.
//
// 사용 예:
//   node pipeline/run.mjs --type srt --file assets/transcripts/x.ko.srt --name my-video
//   node pipeline/run.mjs --type youtube --url "https://youtu.be/..." --lang ko
//   node pipeline/run.mjs --type youtube --url "..." --cookies-from-browser chrome   # 로그인 자막
//   node pipeline/run.mjs --type blog --url "https://blog..." --lang ko
//   node pipeline/run.mjs --script projects/demo/script.json --name demo   # 사전 작성 스크립트 사용
//   옵션: --quality draft|standard|high  --fps 24|30|60  --no-render  --lang ko
//        --cookies-from-browser chrome|safari|edge|firefox  --cookies <cookies.txt>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "./ingest.mjs";
import { summarize } from "./summarize.mjs";
import { narrate } from "./narrate.mjs";
import { compose } from "./compose.mjs";
import { render, lint, snapshot } from "./render.mjs";
import { slugify } from "../lib/util.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { quality: "standard", fps: "30", lang: "ko", render: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--no-render") a.render = false;
    else if (k.startsWith("--")) {
      a[k.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const log = (m) => console.log(`\x1b[36m▶ ${m}\x1b[0m`);

  // 1) 스크립트 확보: 사전 작성(--script) 또는 (인제스트→요약)
  let script;
  if (a.script) {
    log(`스크립트 로드: ${a.script}`);
    script = JSON.parse(await readFile(a.script, "utf8"));
  } else {
    log(`인제스트 (${a.type})...`);
    const src = await ingest({
      type: a.type,
      url: a.url,
      file: a.file,
      lang: a.lang,
      cookies: a.cookies,
      cookiesFromBrowser: a["cookies-from-browser"],
    });
    log(`본문 ${src.text.length}자 확보 — "${src.title}"`);
    log(`요약 → 씬 스크립트...`);
    script = await summarize({
      text: src.text,
      title: src.title,
      source: src.source,
      lang: a.lang,
      topic: a.topic,
    });
    log(`씬 ${script.scenes.length}개 생성`);
  }

  // 음성/속도 오버라이드 (CLI 우선)
  if (a.voice) script.meta.voice = a.voice;
  if (a.rate) script.meta.rate = Number(a.rate);
  if (a.pitch) script.meta.pitch = Number(a.pitch);

  // 2) 프로젝트 폴더
  const name = a.name || slugify(script.meta.title);
  const projDir = join(ROOT, "projects", name);
  await mkdir(projDir, { recursive: true });
  log(`프로젝트: projects/${name}`);

  // 3) 내레이션(TTS) + 타이밍
  log(`내레이션 합성(TTS) + 타이밍 측정...`);
  const { transcript, total } = await narrate({ script, projDir });
  log(`총 길이 ${total}s, 자막 라인 ${transcript.lines.length}개`);

  // 4) 컴포지션 생성
  log(`HyperFrames 컴포지션 생성...`);
  await compose({ script, transcript, projDir });

  // 5) 린트
  log(`린트 검사...`);
  await lint({ projDir });

  // 6) 렌더
  if (a.render) {
    const out = `out/${name}.mp4`;
    log(`렌더링(${a.quality}, ${a.fps}fps) → ${out} ...`);
    const path = await render({ projDir, output: out, fps: Number(a.fps), quality: a.quality });
    log(`완료: ${path}`);
    console.log(`\n\x1b[32m✅ 영상 생성 완료:\x1b[0m ${path}`);
  } else {
    log(`--no-render: 렌더 생략. 미리보기: cd projects/${name} && npm run dev`);
  }
}

main().catch((e) => {
  console.error(`\x1b[31m✗ 실패:\x1b[0m`, e.message);
  process.exit(1);
});
