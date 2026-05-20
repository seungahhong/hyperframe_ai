// 1단계: 인제스트 — 링크/파일에서 원본 텍스트 + 메타데이터를 뽑는다.
//  - youtube : yt-dlp(uvx)로 자막 다운로드 → 본문화
//  - srt     : 로컬 자막 파일 → 본문화
//  - blog    : URL fetch → 본문 추출
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/util.mjs";
import { parseSrt, cuesToPlainText, readSrtAsText } from "../lib/srt.mjs";

/** 입력 소스 → { title, source, lang, text } */
export async function ingest({ type, url, file, lang = "ko" }) {
  if (type === "srt") return ingestSrt({ file, lang });
  if (type === "youtube") return ingestYoutube({ url, lang });
  if (type === "blog") return ingestBlog({ url, lang });
  throw new Error(`알 수 없는 type: ${type}`);
}

async function ingestSrt({ file, lang }) {
  const text = await readSrtAsText(file);
  return { title: file.split("/").pop().replace(/\.[a-z]+\.srt$/i, ""), source: file, lang, text };
}

async function ingestYoutube({ url, lang }) {
  const tmp = join(tmpdir(), `hfyt-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  // 제목
  let title = "youtube";
  try {
    title = String(
      await capture("uvx", ["yt-dlp", "--skip-download", "--print", "%(title)s", url]),
    ).trim();
  } catch {}
  // 자막(요청 언어 우선, 없으면 영어 자동자막)
  await capture("uvx", [
    "yt-dlp",
    "--skip-download",
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs",
    `${lang},en`,
    "--sub-format",
    "srt/vtt/best",
    "--convert-subs",
    "srt",
    "-o",
    join(tmp, "sub.%(ext)s"),
    url,
  ]).catch(() => {});
  const files = (await readdir(tmp)).filter((f) => f.endsWith(".srt"));
  if (!files.length) throw new Error("자막을 찾지 못했습니다.");
  // 요청 언어 파일 우선
  const pick = files.find((f) => f.includes(`.${lang}.`)) || files[0];
  const raw = await readFile(join(tmp, pick), "utf8");
  const text = cuesToPlainText(parseSrt(raw));
  await rm(tmp, { recursive: true, force: true });
  return { title, source: url, lang, text };
}

async function ingestBlog({ url, lang }) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (hyperframe-ai ingest)" },
  });
  if (!res.ok) throw new Error(`blog fetch 실패: ${res.status}`);
  const html = await res.text();
  const title =
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "blog").trim();
  // <main>/<article> 우선, 없으면 <body>
  const scope =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    html.match(/<body[\s\S]*?<\/body>/i)?.[0] ||
    html;
  const text = scope
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return { title, source: url, lang, text };
}

// CLI 직접 실행 지원: node pipeline/ingest.mjs --type srt --file ...
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const r = await ingest(a);
  console.log(JSON.stringify({ ...r, text: r.text.slice(0, 500) + " ..." }, null, 2));
  console.log(`\n[본문 길이] ${r.text.length}자`);
}

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1], i++;
  }
  return a;
}
