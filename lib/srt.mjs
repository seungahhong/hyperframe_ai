// SRT/VTT 자막 파서 + 정리기.
// 유튜브 자동 자막은 한 줄씩 굴러가며 중복(롤링)되므로 합쳐서 깨끗한 본문으로 만든다.
import { readFile } from "node:fs/promises";

const TS = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function toSec(h, m, s, ms) {
  return +h * 3600 + +m * 60 + +s + +ms / 1000;
}

/**
 * SRT 텍스트를 [{ start, end, text }] 큐 배열로 파싱.
 */
export function parseSrt(raw) {
  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const tline = lines.find((l) => l.includes("-->"));
    if (!tline) continue;
    const [a, bb] = tline.split("-->").map((x) => x.trim());
    const ma = a.match(TS);
    const mb = bb.match(TS);
    if (!ma || !mb) continue;
    const start = toSec(ma[1], ma[2], ma[3], ma[4]);
    const end = toSec(mb[1], mb[2], mb[3], mb[4]);
    const text = lines
      .filter((l) => l !== tline && !/^\d+$/.test(l.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

/**
 * 롤링 중복을 제거하고 하나의 연속 본문 문자열로 합친다.
 * 직전 큐의 꼬리와 다음 큐의 머리가 겹치면 겹친 만큼만 이어 붙인다.
 */
export function cuesToPlainText(cues) {
  let out = "";
  for (const { text } of cues) {
    if (!out) {
      out = text;
      continue;
    }
    // 가장 긴 (out의 접미사 == text의 접두사) 겹침 길이를 찾는다.
    const max = Math.min(out.length, text.length);
    let overlap = 0;
    for (let k = max; k > 0; k--) {
      if (out.slice(out.length - k) === text.slice(0, k)) {
        overlap = k;
        break;
      }
    }
    out += text.slice(overlap);
  }
  return out.replace(/\s+/g, " ").trim();
}

export async function readSrtAsText(path) {
  const raw = await readFile(path, "utf8");
  return cuesToPlainText(parseSrt(raw));
}
