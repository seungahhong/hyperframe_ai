// 2단계: 요약 — 원본 텍스트를 "씬 스크립트(script.json)"로 변환한다.
//
// 우선순위:
//  (A) Ollama 로컬 LLM (기본 gemma4:26b) — 완전 오프라인·무료·고품질
//  (B) ANTHROPIC_API_KEY 가 있으면 Claude API (프롬프트 캐시)
//  (C) 추출식 폴백 — 핵심 문장 키프레이즈
//
// 결과 스키마(공통):
//  { meta:{title,subtitle,lang,topic,source,voice}, scenes:[{id,heading,visual,data,lines[]}] }
//
// visual 타입: title | stat | list | compare | bars | cta

const MODEL = process.env.HF_LLM_MODEL || "claude-sonnet-4-6";
// Lazy 참조: 테스트가 환경변수를 끄고 폴백을 강제할 수 있도록 호출 시점에 읽는다.
const ollamaUrl = () => process.env.HF_OLLAMA_URL || "http://localhost:11434";
const ollamaModel = () => process.env.HF_OLLAMA_MODEL || "gemma4:26b";

const SYSTEM = `당신은 한국어 모션그래픽 영상의 기획자다. 주어진 자막/본문을 풍부한 한국어 설명 영상 스크립트로 재구성한다.

[언어 — 가장 중요]
- 모든 화면 표시 텍스트(meta.title, meta.subtitle, heading, data.items, data.label, data.caption, data.sub, lines, compare.points 등)는 반드시 자연스러운 한국어.
- 영어 고유명사·기술 약어(예: TPU, MCP, AI, IO, Gemini, Cloud Next, Sundar Pichai)는 원문 그대로 유지 가능. 그 외 일반 영어 단어는 한국어로 번역한다.
- 영문 콜론 헤딩(예: "Gemini Spark: Your Personal AI Agent") 금지. → "지속 작업하는 개인 에이전트 ‘스파크’" 처럼 한국어로.

[분량 — 두 번째로 중요]
- 90~150초 분량. 자막(lines 합계) 25~40줄. 본문 정보를 핵심만 압축하지 말고 풍부하게 다룬다.
- 6~9개의 씬. 각 씬 lines 3~6개. 한 line 은 14~28자의 자연스러운 구어체 (예: "~했어요", "~합니다", "~죠").
- 첫 씬 visual="title", 마지막 visual="cta". 중간은 내용에 따라 다양하게 섞는다.

[화면 키프레이즈]
- data.items / value 등 화면 텍스트는 의미 단위 명사구(6~14자, 담화 표지/주어/조사 빼고).
  · 나쁜 예: "그 이후로 우리는 업계가 AI를"   좋은 예: "TPU 8T 도입", "4배 빠른 속도"
- list.items 는 반드시 문자열 배열. {label, value} 같은 객체는 list 에 넣지 말 것.
- 수치 비교는 visual="bars" 로 옮기고, list 에는 사용자 향 키프레이즈만.

[시각 연출 분배]
- 숫자/단일 통계 → "stat"
- 항목 나열 → "list"
- A vs B 대비 → "compare"
- 여러 수치 비교 → "bars"

[출력]
- 반드시 아래 JSON 스키마만. 설명·마크다운·코드펜스 금지.

스키마:
{"meta":{"title":string,"subtitle":string},"scenes":[{"heading":string,"visual":"title|stat|list|compare|bars|cta","data":object,"lines":string[]}]}

data 예시(정확히 이 키만, 모두 한국어):
- title:   {"title":"제미나이 3.5","subtitle":"가장 강력한 에이전트 모델"}
- stat:    {"value":"4배","caption":"초당 출력 토큰","sub":"다른 프런티어 대비"}
- list:    {"items":["TPU 8T 도입","듀얼 칩 방식","8세대 공개"]}
- compare: {"left":{"title":"기존","points":["한 번 묻고","단발 응답"]},"right":{"title":"신형","points":["계획·실행","반복 자기검증"]}}
- bars:    {"unit":"%","items":[{"label":"터미널","value":76.2},{"label":"멀티모달","value":84.2}]}
- cta:     {}`;

export async function summarize({ text, title, source, lang = "ko", topic, voice = "Yuna" }) {
  let script;
  if (await ollamaAlive()) {
    script = await summarizeOllama({ text, title, topic });
  } else if (process.env.ANTHROPIC_API_KEY) {
    script = await summarizeLLM({ text, title, topic, key: process.env.ANTHROPIC_API_KEY });
  } else {
    script = extractiveFallback({ text, title, topic });
  }
  // 메타 보강 + 씬 id 부여
  script.meta = {
    title: script.meta?.title || title,
    subtitle: script.meta?.subtitle || "",
    lang,
    topic: topic || title,
    source: source || "",
    voice,
  };
  script.scenes = (script.scenes || []).map((s, i) => ({
    id: `scene-${i + 1}`,
    heading: typeof s.heading === "string" ? s.heading : "",
    visual: s.visual || (i === 0 ? "title" : "list"),
    data: normalizeData(s.visual, s.data),
    lines: (s.lines || []).map(toCleanStr).filter(Boolean),
  }));
  return script;
}

// LLM이 가끔 잘못된 형식(예: list.items 안에 {label,value} 객체)을 만들어 컴포지션에서
// "[object Object]"가 표시되는 걸 방지. 비주얼 타입별 기대 형식으로 안전하게 강제 변환.
function toCleanStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    // bars 객체가 list 자리에 들어온 경우 등 — label/title/text/name 우선 추출, 값도 붙임
    const label = v.label || v.title || v.text || v.name || v.key;
    const val = v.value ?? v.val ?? v.amount;
    if (label && val != null) return `${label} ${val}`.trim();
    if (label) return String(label).trim();
    if (val != null) return String(val).trim();
    return Object.values(v).filter((x) => typeof x === "string" || typeof x === "number").join(" ").trim();
  }
  return String(v);
}
function normalizeData(visual, d) {
  d = d && typeof d === "object" ? { ...d } : {};
  if (visual === "list") {
    d.items = Array.isArray(d.items) ? d.items.map(toCleanStr).filter(Boolean) : [];
  } else if (visual === "bars") {
    // items 는 {label, value} 배열 그대로. 단 label은 문자열로, value는 숫자로.
    const items = Array.isArray(d.items) ? d.items : [];
    d.items = items
      .map((it) => (typeof it === "object" && it ? { label: toCleanStr(it.label), value: Number(it.value) } : null))
      .filter((it) => it && it.label && !Number.isNaN(it.value));
  } else if (visual === "compare") {
    const side = (x) => ({
      title: toCleanStr(x?.title || ""),
      points: Array.isArray(x?.points) ? x.points.map(toCleanStr).filter(Boolean) : [],
    });
    d.left = side(d.left);
    d.right = side(d.right);
  } else if (visual === "stat") {
    d.value = toCleanStr(d.value || "");
    d.caption = toCleanStr(d.caption || "");
    d.sub = toCleanStr(d.sub || "");
  } else if (visual === "title") {
    d.title = toCleanStr(d.title || "");
    d.subtitle = toCleanStr(d.subtitle || "");
  }
  return d;
}

// Ollama 서버가 떠 있는지(=API 응답하는지) 확인.
async function ollamaAlive() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

// Ollama 로컬 LLM(gemma4 등)로 한국어 스크립트 생성. format:"json"으로 JSON 강제.
// 스트리밍 응답을 사용해 undici 기본 timeout(300s)을 회피한다. 26B 모델 + 긴 입력은
// 응답 완료까지 수 분 걸릴 수 있는데, 청크가 계속 흘러오면 타임아웃이 리셋된다.
async function summarizeOllama({ text, title, topic }) {
  // 시도 순서: 기본 모델 → 같은 모델 다른 시드 → 작은 모델 폴백(e4b).
  // 큰 모델(26b)이 반복 루프(token repetition)에 빠질 때 e4b가 의외로 더 안정적인 경우가 많다.
  // gemma4:26b 는 한국어 + 긴 JSON에서 token-repetition loop에 자주 빠진다.
  // 실측: 강한 repeat_penalty 로도 회피 어려움. e4b 가 짧지만 안정적이라 폴백 우선순위로.
  const primary = ollamaModel();
  const tries = [
    { model: primary, seed: 7, repeatPenalty: 1.5 },        // 사용자 지정 모델, 강한 페널티
    { model: "gemma4:e4b", seed: 11, repeatPenalty: 1.2 },  // 안정 폴백
    { model: "gemma4:e4b", seed: 42, repeatPenalty: 1.2 },  // 다른 시드 마지막
  ];
  let lastErr;
  for (let i = 0; i < tries.length; i++) {
    const { model, seed, repeatPenalty } = tries[i];
    const raw = await callOllamaChat({ text, title, topic, model, seed, repeatPenalty });
    try {
      return parseLlmJson(raw);
    } catch (e) {
      lastErr = e;
      try {
        const { writeFile } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const dump = join(tmpdir(), `ollama-bad-${Date.now()}-try${i + 1}-${model.replace(":", "_")}.txt`);
        await writeFile(dump, raw, "utf8");
        process.stderr.write(`\x1b[33m  · Ollama(${model}) JSON 실패(${e.message.slice(0, 60)}) → ${dump}\x1b[0m\n`);
      } catch {}
      if (i < tries.length - 1) {
        const next = tries[i + 1];
        process.stderr.write(`\x1b[33m  · 재시도: ${next.model} (시드=${next.seed})\x1b[0m\n`);
      }
    }
  }
  throw lastErr;
}

function parseLlmJson(out) {
  const i = out.indexOf("{");
  const j = out.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error(`응답이 JSON 아님: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(i, j + 1));
}

async function callOllamaChat({ text, title, topic, model, seed, repeatPenalty }) {
  const body = {
    model: model || ollamaModel(),
    stream: true,
    format: "json",
    options: {
      // 반복 루프 방지:
      //  · repeat_penalty — 큰 모델일수록 강한 값(1.5)이 필요한 케이스 다수.
      //  · temperature 0.4 — 너무 낮으면(0.1) 오히려 같은 패턴 고착
      //  · num_predict 4096 — 무한 반복 길이 제한
      //  · seed — 시드별 다른 출발점
      temperature: 0.4,
      top_p: 0.9,
      repeat_penalty: repeatPenalty ?? 1.3,
      num_ctx: 16384,
      num_predict: 4096,
      seed: seed ?? 7,
    },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `제목: ${title}\n주제 힌트: ${topic || "(자동)"}\n\n` +
          `자막/본문:\n${text}\n\n` +
          `위 자막을 바탕으로 한국어 모션그래픽 영상 스크립트를 작성하라. 반드시 6~9개 씬을 끝까지 모두 작성하고 마지막은 visual="cta"로 마무리한다. JSON 외 다른 출력 금지.`,
      },
    ],
  };
  const res = await fetch(`${ollamaUrl()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  // NDJSON 스트림: 각 줄 = {message:{content},done:bool}
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
        const c = obj.message?.content;
        if (c) out += c;
      } catch {
        // 한 줄이 완전치 않거나 비정상 라인 — 무시하고 계속.
      }
    }
  }
  return out;
}

async function summarizeLLM({ text, title, topic, key }) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `제목: ${title}\n주제 힌트: ${topic || "(자동)"}\n\n원문:\n${text}`,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: "위 원문을 스키마에 맞는 JSON 스크립트로 변환해줘." },
        ],
      },
    ],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const txt = data.content.map((b) => b.text || "").join("");
  const json = txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// 화면용 짧은 키프레이즈. 한국어 문맥에 맞게 의미 단위로 다듬는다.
// 1) 담화 표지 / 시간 부사 / 주어 NP 를 앞쪽에서 제거
// 2) 종결 어미·서술어 꼬리를 끝쪽에서 제거
// 3) 짧으면 그대로, 길면 명사/고유명사(영문·숫자 포함) 우선 점수로 윈도우 선택
// 4) 끝의 조사·구두점 정리 → 마지막 폴백은 어절 경계 잘라내기
const KO_LEAD_DROP = [
  // 시간/순서/담화 표지
  "그리고","그래서","그러나","하지만","또한","따라서","그러므로","그러니까",
  "이번에","이번엔","이번에는","이번이","지금","오늘","어제","최근에","앞서","방금",
  "그 이후로","그 이후에","그 후로","그 후에","이후로","이후에",
  "한편","다만","단","우선","먼저","다음으로","마지막으로",
  "특히","무엇보다","아울러","참고로","사실","결국","즉","예를 들어","말하자면",
  "여기서","이제","그러면","그래서요","말씀드리면",
  "보시다시피","말했듯이","말씀드린대로","앞서 말씀드린",
  // 처음으로 / 마침내
  "처음으로","마침내","드디어","최초로",
];
const KO_SUBJ_NP = /^([가-힣A-Za-z0-9]{1,12})(은|는|이|가)\s+/u;
const KO_VERB_TAIL =
  /(했|합|됐|됩|있|없|였|이었|되었|이|되)(습니다|어요|에요|예요|군요|네요|다)\.?\s*$/u;
const KO_TRAILING_PARTICLE =
  /(을|를|이|가|은|는|와|과|에|에서|에게|의|로|으로|도|만|까지|부터|보다|처럼|같이|마다)$/u;

function stripLeads(s) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const lead of KO_LEAD_DROP) {
      const re = new RegExp(`^${lead.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s,]*`, "u");
      if (re.test(s)) { s = s.replace(re, ""); changed = true; }
    }
    if (KO_SUBJ_NP.test(s)) { s = s.replace(KO_SUBJ_NP, ""); changed = true; }
  }
  return s;
}
function stripVerbTail(s) {
  return s.replace(KO_VERB_TAIL, "").trim();
}
// 각 어절(토큰)에 정보량 점수.
function tokenScore(tok) {
  let n = 0;
  if (/[A-Z]{2,}|[A-Z][a-z]+|[A-Za-z]+\d|\d[A-Za-z]+/.test(tok)) n += 5; // 영문 약어/PascalCase/모델명
  if (/\d/.test(tok)) n += 3;                                            // 수치
  if (/[가-힣]{2,}/.test(tok)) n += 1;                                   // 한글 명사 후보
  if (KO_TRAILING_PARTICLE.test(tok)) n -= 1;                            // 조사로 끝나면 살짝 감점
  if (/^(우리|저희|이것|그것|저것|이|그|저|것)/.test(tok)) n -= 2;        // 대명사/지시어 감점
  return n;
}
export function keyphrase(s, max = 18) {
  s = String(s).replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = stripVerbTail(stripLeads(s));
  // 짧으면 그대로(끝 조사만 정리)
  if (s.length <= max) return s.replace(KO_TRAILING_PARTICLE, "").trim() || s;
  // 점수 윈도우: 연속 어절 묶음 중 max 이내·최고 점수
  const toks = s.split(" ");
  const scores = toks.map(tokenScore);
  let best = { score: -Infinity, str: "" };
  for (let i = 0; i < toks.length; i++) {
    let str = "", sum = 0;
    for (let j = i; j < toks.length; j++) {
      const next = (str ? str + " " : "") + toks[j];
      if (next.length > max) break;
      str = next; sum += scores[j];
      // 동점이면 더 긴 윈도우 선호(정보 밀도 ↑)
      if (sum > best.score || (sum === best.score && str.length > best.str.length)) {
        best = { score: sum, str };
      }
    }
  }
  let out = (best.str || s.slice(0, max)).trim();
  // 끝 조사/구두점 정리
  out = out.replace(/[\s,·]+$/, "").replace(KO_TRAILING_PARTICLE, "").trim();
  // 안전 폴백
  if (out.length > max) {
    const cut = out.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    out = (sp >= 4 ? cut.slice(0, sp) : cut).trim();
  }
  return out || s.slice(0, max);
}

// 자막/보이스용. 긴 문장을 "자르지 않고" 자막 청크로 분할(쉼표 → 공백 경계).
export function splitCaption(s, max = 34) {
  s = String(s).replace(/\s+/g, " ").trim();
  const out = [];
  let cur = "";
  for (const part of s.split(/(?<=[,，])\s*/).filter(Boolean)) {
    if ((cur + part).length > max && cur) { out.push(cur.trim()); cur = part; }
    else cur += part;
  }
  if (cur.trim()) out.push(cur.trim());
  // 여전히 긴 청크는 공백 기준으로 추가 분할(여전히 잘라내지 않음)
  const final = [];
  for (const p of out) {
    if (p.length <= max) { final.push(p); continue; }
    let c = "";
    for (const w of p.split(" ")) {
      if ((c + " " + w).trim().length > max && c) { final.push(c.trim()); c = w; }
      else c = (c + " " + w).trim();
    }
    if (c) final.push(c);
  }
  return final;
}

// UI/잡음 문장 제거용
const JUNK =
  /(this content|generated by|음성으로 기사 듣기|구독|뉴스레터|cookie|쿠키|로그인|저작권|©|https?:\/\/|www\.)/i;

// 키가 없을 때: 문장 분할 → 잡음 제거 → 핵심 문장 추출 → 간결화 → 기본 씬 구성.
// (주의: 추출식 폴백은 한계가 있다. 고품질 결과는 ANTHROPIC_API_KEY 또는 에이전트가
//  직접 작성한 script.json 을 쓰는 것을 권장 — README/SKILL 참조.)
function extractiveFallback({ text, title, topic }) {
  const sentences = text
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 90)
    .filter((s) => !JUNK.test(s))
    // 한글 비중이 40% 이상인 문장만(영문 UI 텍스트 배제)
    .filter((s) => (s.match(/[가-힣]/g) || []).length >= s.length * 0.4);
  const uniq = [...new Set(sentences)];
  const score = (s) =>
    (/\d/.test(s) ? 3 : 0) +
    Math.min(s.length / 16, 2) +
    (/(중요|핵심|반드시|결국|즉|돌파|급증|넘어|최초|최대|처음)/.test(s) ? 2 : 0);
  const ranked = uniq.sort((a, b) => score(b) - score(a)).slice(0, 8);

  const scenes = [
    {
      heading: keyphrase(title, 20),
      visual: "title",
      data: { title: keyphrase(title, 20), subtitle: topic ? keyphrase(topic, 24) : "" },
      lines: ["핵심을 빠르게 정리했습니다."],
    },
  ];
  // 2문장씩 묶어 list 씬으로.
  //  - 화면 항목(items): 짧은 키프레이즈(잘림/말줄임표 없음)
  //  - 자막+보이스(lines): 문장 전체를 청크로 분할 → 더 많은 내용이 자막/음성으로 전달
  const chunk = 2;
  for (let i = 0; i < ranked.length && scenes.length < 5; i += chunk) {
    const group = ranked.slice(i, i + chunk);
    scenes.push({
      heading: "",
      visual: "list",
      data: { items: group.map((l) => keyphrase(l, 18)) },
      lines: group.flatMap((l) => splitCaption(l, 34)),
    });
  }
  scenes.push({
    heading: "",
    visual: "cta",
    data: {},
    lines: ["자세한 내용은 원문에서 확인하세요."],
  });
  return { meta: { title, subtitle: topic || "" }, scenes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import("node:fs/promises");
  const file = process.argv[2];
  const text = await readFile(file, "utf8");
  const out = await summarize({ text, title: "test", lang: "ko" });
  console.log(JSON.stringify(out, null, 2));
}
