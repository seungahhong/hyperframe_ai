// 4단계: 컴포지션 생성 — script + transcript(타이밍) + 오디오로
// 렌더 가능한 HyperFrames 프로젝트(index.html 등)를 만든다.
//
// 단일 루트 컴포지션(master) 안에:
//  - <audio> 내레이션 1개
//  - 씬별 비주얼 클립 N개 (class="clip" 으로 표시 구간 자동 제어)
//  - 자막 클립(라인별)
//  - master GSAP 타임라인(절대 시간 위치로 등장 애니메이션)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { THEME, accentFor } from "../templates/theme.mjs";
import { esc, jsString, round2 } from "../lib/util.mjs";

export async function compose({ script, transcript, projDir }) {
  await mkdir(join(projDir, "compositions"), { recursive: true });

  const total = transcript.total;
  const scenes = script.scenes;

  // ---- 씬별 마크업 + 애니메이션 코드 생성 ----
  const sceneHtml = [];
  const animBlocks = [];
  scenes.forEach((scene, i) => {
    const accent = accentFor(i);
    const { html, anim } = renderVisual(scene, accent);
    sceneHtml.push(`      <div class="scene" id="${scene.id}">\n${html}\n      </div>`);
    // 씬 표시 구간을 master 타임라인의 인라인 display 토글로 직접 제어한다
    // (프레임워크의 clip 가시성보다 인라인 스타일 우선순위가 높아 확실히 동작).
    const isLast = i === scenes.length - 1;
    const show = `tl.set("#${scene.id}", {display:"flex"}, ${scene.start});`;
    const hide = isLast ? "" : `\ntl.set("#${scene.id}", {display:"none"}, ${scene.end});`;
    animBlocks.push(`${show}${hide}\n${anim(scene.start)}`);
  });

  // ---- 자막: 라인별 div + 타임라인 display 토글(공식 샘플 방식) ----
  const caps = buildCaptions(transcript);
  animBlocks.push(caps.anim);

  const html = pageHtml({
    title: script.meta.title,
    total,
    sceneHtml: sceneHtml.join("\n\n"),
    captionHtml: caps.html,
    animJs: animBlocks.join("\n\n"),
  });

  await writeFile(join(projDir, "index.html"), html, "utf8");

  // 프로젝트 메타/설정/스크립트
  await writeFile(
    join(projDir, "meta.json"),
    JSON.stringify({ id: basename(projDir), name: script.meta.title, createdAt: new Date().toISOString() }, null, 2),
  );
  await writeFile(
    join(projDir, "hyperframes.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(projDir, "package.json"),
    JSON.stringify(
      {
        name: basename(projDir),
        private: true,
        type: "module",
        scripts: {
          dev: "npx --yes hyperframes@0.6.29 preview",
          check: "npx --yes hyperframes@0.6.29 lint",
          render: "npx --yes hyperframes@0.6.29 render",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(projDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  await writeFile(join(projDir, "script.json"), JSON.stringify(script, null, 2));

  return { indexHtml: join(projDir, "index.html") };
}

function basename(p) {
  return p.split("/").filter(Boolean).pop();
}

// ----------------------------------------------------------------------------
// 비주얼 렌더러: 타입별로 { html, anim(start)->js } 반환
// ----------------------------------------------------------------------------
function renderVisual(scene, accent) {
  const id = scene.id;
  const sel = `#${id}`;
  switch (scene.visual) {
    case "title":
      return renderTitle(scene, accent, sel);
    case "stat":
      return renderStat(scene, accent, sel);
    case "compare":
      return renderCompare(scene, accent, sel);
    case "bars":
      return renderBars(scene, accent, sel);
    case "cta":
      return renderCta(scene, accent, sel);
    case "list":
    default:
      return renderList(scene, accent, sel);
  }
}

function renderTitle(scene, accent, sel) {
  const sub = scene.data.subtitle || scene.heading || "";
  const html = `        <div class="t-wrap">
          <div class="t-rule" style="background:${accent}"></div>
          <h1 class="t-title">${esc(scene.data.title || scene.heading)}</h1>
          ${sub ? `<p class="t-sub">${esc(sub)}</p>` : ""}
        </div>`;
  const anim = (s) => `// ${scene.id} (title)
tl.fromTo("${sel} .t-rule", {scaleX:0, transformOrigin:"left center"}, {scaleX:1, duration:0.5, ease:"power3.out"}, ${s + 0.1});
tl.fromTo("${sel} .t-title", {y:60, opacity:0}, {y:0, opacity:1, duration:0.6, ease:"power3.out"}, ${s + 0.25});
tl.fromTo("${sel} .t-sub", {y:30, opacity:0}, {y:0, opacity:1, duration:0.5, ease:"power2.out"}, ${s + 0.5});`;
  return { html, anim };
}

function renderStat(scene, accent, sel) {
  // 카운트업은 onUpdate 콜백에 의존하는데, HyperFrames는 프레임을 seek로 렌더하면서
  // 콜백을 억제한다. 그래서 최종 수치를 두고 속성 애니메이션(스케일/페이드)으로 강조한다.
  const raw = String(scene.data.value ?? "0");
  const html = `        <div class="st-wrap">
          <div class="st-num" style="color:${accent}">${esc(raw)}</div>
          <div class="st-cap">${esc(scene.data.caption || scene.heading || "")}</div>
          ${scene.data.sub ? `<div class="st-sub">${esc(scene.data.sub)}</div>` : ""}
        </div>`;
  const anim = (s) => `// ${scene.id} (stat)
tl.fromTo("${sel} .st-num", {scale:0.6, opacity:0}, {scale:1, opacity:1, duration:0.7, ease:"back.out(1.6)"}, ${s + 0.1});
tl.fromTo("${sel} .st-cap", {y:24, opacity:0}, {y:0, opacity:1, duration:0.5, ease:"power2.out"}, ${s + 0.6});
tl.fromTo("${sel} .st-sub", {opacity:0}, {opacity:1, duration:0.5}, ${s + 0.9});`;
  return { html, anim };
}

function renderList(scene, accent, sel) {
  const items = scene.data.items && scene.data.items.length ? scene.data.items : scene.lines;
  const lis = items
    .map(
      (it, i) =>
        `          <li class="ls-item"><span class="ls-idx" style="color:${accent}">${String(i + 1).padStart(2, "0")}</span><span class="ls-txt">${esc(it)}</span></li>`,
    )
    .join("\n");
  const html = `        <div class="ls-wrap">
          ${scene.heading ? `<h2 class="ls-head"><span style="color:${accent}">▍</span> ${esc(scene.heading)}</h2>` : ""}
          <ul class="ls-list">
${lis}
          </ul>
        </div>`;
  const anim = (s) => `// ${scene.id} (list)
tl.fromTo("${sel} .ls-head", {x:-30, opacity:0}, {x:0, opacity:1, duration:0.5, ease:"power3.out"}, ${s + 0.1});
tl.fromTo("${sel} .ls-item", {x:40, opacity:0}, {x:0, opacity:1, duration:0.5, ease:"power2.out", stagger:0.18}, ${s + 0.3});`;
  return { html, anim };
}

function renderCompare(scene, accent, sel) {
  const L = scene.data.left || { title: "A", points: [] };
  const R = scene.data.right || { title: "B", points: [] };
  const col = (side, c, accentC) =>
    `          <div class="cmp-col cmp-${side}">
            <div class="cmp-title" style="border-color:${accentC};color:${accentC}">${esc(c.title)}</div>
            <ul>${(c.points || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
          </div>`;
  const html = `        <div class="cmp-wrap">
          ${scene.heading ? `<h2 class="cmp-head">${esc(scene.heading)}</h2>` : ""}
          <div class="cmp-cols">
${col("left", L, THEME.inkDim)}
            <div class="cmp-vs" style="color:${accent}">→</div>
${col("right", R, accent)}
          </div>
        </div>`;
  const anim = (s) => `// ${scene.id} (compare)
tl.fromTo("${sel} .cmp-head", {y:-20,opacity:0},{y:0,opacity:1,duration:0.4}, ${s + 0.1});
tl.fromTo("${sel} .cmp-left", {x:-60, opacity:0}, {x:0, opacity:1, duration:0.6, ease:"power3.out"}, ${s + 0.25});
tl.fromTo("${sel} .cmp-vs", {scale:0, opacity:0}, {scale:1, opacity:1, duration:0.4, ease:"back.out(2)"}, ${s + 0.5});
tl.fromTo("${sel} .cmp-right", {x:60, opacity:0}, {x:0, opacity:1, duration:0.6, ease:"power3.out"}, ${s + 0.55});`;
  return { html, anim };
}

function renderBars(scene, accent, sel) {
  const items = scene.data.items || [];
  const unit = scene.data.unit || "";
  const max = Math.max(1, ...items.map((it) => Number(it.value) || 0));
  const bars = items
    .map(
      (it, i) =>
        `            <div class="bar-row">
              <div class="bar-label">${esc(it.label)}</div>
              <div class="bar-track"><div class="bar-fill" data-w="${Math.round(((Number(it.value) || 0) / max) * 100)}" style="background:${accentFor(i)}"></div></div>
              <div class="bar-val">${esc(String(it.value))}${esc(unit)}</div>
            </div>`,
    )
    .join("\n");
  const html = `        <div class="bar-wrap">
          ${scene.heading ? `<h2 class="bar-head">${esc(scene.heading)}</h2>` : ""}
          <div class="bar-list">
${bars}
          </div>
        </div>`;
  const anim = (s) => `// ${scene.id} (bars)
tl.fromTo("${sel} .bar-head", {y:-20,opacity:0},{y:0,opacity:1,duration:0.4}, ${s + 0.1});
tl.fromTo("${sel} .bar-row", {opacity:0}, {opacity:1, duration:0.3, stagger:0.15}, ${s + 0.25});
document.querySelectorAll("${sel} .bar-fill").forEach(function(el,i){
  tl.fromTo(el, {width:"0%"}, {width: el.getAttribute("data-w")+"%", duration:0.9, ease:"power3.out"}, ${s + 0.35} + i*0.15);
});`;
  return { html, anim };
}

function renderCta(scene, accent, sel) {
  const lines = scene.lines.length ? scene.lines : [scene.heading];
  const html = `        <div class="cta-wrap">
          <div class="cta-rule" style="background:${accent}"></div>
          ${lines.map((l, i) => `<div class="cta-line ${i === 0 ? "cta-strong" : ""}">${esc(l)}</div>`).join("\n          ")}
        </div>`;
  const anim = (s) => `// ${scene.id} (cta)
tl.fromTo("${sel} .cta-rule", {scaleX:0, transformOrigin:"center"}, {scaleX:1, duration:0.5, ease:"power3.out"}, ${s + 0.1});
tl.fromTo("${sel} .cta-line", {y:30, opacity:0}, {y:0, opacity:1, duration:0.5, ease:"power2.out", stagger:0.2}, ${s + 0.3});`;
  return { html, anim };
}

// ----------------------------------------------------------------------------
// 자막: 라인 단위 클립. 같은 씬 안에서는 다음 라인 시작까지 유지(깜빡임 방지).
// ----------------------------------------------------------------------------
function buildCaptions(transcript) {
  const lines = transcript.lines;
  const GAP = 0.06; // 인접 자막이 경계에서 겹치지 않도록 살짝 띄운다.
  const html = [];
  const anim = ["// captions (master 타임라인 display 토글)"];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    const id = `cap-${i + 1}`;
    const sameSceneNext = next && next.sceneId === cur.sceneId;
    const end = sameSceneNext ? round2(next.start - GAP) : round2(cur.end + 0.35);
    html.push(`      <div class="caption" id="${id}"><span>${esc(cur.text)}</span></div>`);
    anim.push(
      `tl.set("#${id}", {display:"block"}, ${cur.start}); tl.set("#${id}", {display:"none"}, ${end});`,
    );
  }
  return { html: html.join("\n"), anim: anim.join("\n") };
}

// ----------------------------------------------------------------------------
// 페이지 셸
// ----------------------------------------------------------------------------
function pageHtml({ title, total, sceneHtml, captionHtml, animJs }) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(title)} — Hyperframe AI</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      :root{
        --bg:${THEME.bg}; --ink:${THEME.ink}; --dim:${THEME.inkDim};
      }
      html,body{margin:0;padding:0;width:${THEME.width}px;height:${THEME.height}px;overflow:hidden;background:var(--bg);font-family:${THEME.fontSans};}
      #master-root{position:relative;width:${THEME.width}px;height:${THEME.height}px;background:
        radial-gradient(1200px 700px at 78% 18%, #14204a 0%, rgba(20,32,74,0) 60%),
        radial-gradient(900px 600px at 12% 88%, #0f2a3a 0%, rgba(15,42,58,0) 55%),
        var(--bg);}
      /* 미세 그리드 */
      #master-root::before{content:"";position:absolute;inset:0;background-image:
        linear-gradient(${THEME.grid} 1px, transparent 1px),
        linear-gradient(90deg, ${THEME.grid} 1px, transparent 1px);
        background-size:80px 80px;opacity:.5;}
      .scene{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 180px;box-sizing:border-box;}
      .caption{position:absolute;left:50%;bottom:${THEME.captionBottom}px;transform:translateX(-50%);max-width:1500px;display:none;text-align:center;}
      .caption span{display:inline-block;background:rgba(7,11,26,.72);backdrop-filter:blur(2px);color:var(--ink);
        font-size:${THEME.captionFontSize}px;font-weight:600;line-height:1.35;padding:14px 30px;border-radius:14px;
        border:1px solid #ffffff14;text-align:center;word-break:keep-all;overflow-wrap:anywhere;}

      /* title */
      .t-wrap{max-width:1400px}
      .t-rule{width:220px;height:12px;border-radius:6px;margin-bottom:36px}
      .t-title{font-size:130px;font-weight:800;line-height:1.02;letter-spacing:-.03em;margin:0;color:var(--ink);word-break:keep-all}
      .t-sub{font-size:46px;font-weight:500;color:var(--dim);margin:28px 0 0}

      /* stat */
      .st-wrap{text-align:center}
      .st-num{font-size:300px;font-weight:900;line-height:.9;letter-spacing:-.04em}
      .st-cap{font-size:54px;font-weight:700;color:var(--ink);margin-top:18px}
      .st-sub{font-size:34px;color:var(--dim);margin-top:14px}

      /* list */
      .ls-wrap{width:100%;max-width:1500px}
      .ls-head{font-size:60px;font-weight:800;color:var(--ink);margin:0 0 50px}
      .ls-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:30px}
      .ls-item{display:flex;align-items:baseline;gap:34px}
      .ls-idx{font-family:${THEME.fontMono};font-size:46px;font-weight:700;min-width:74px}
      .ls-txt{font-size:54px;font-weight:600;color:var(--ink);word-break:keep-all;overflow-wrap:anywhere}

      /* compare */
      .cmp-wrap{width:100%;max-width:1600px}
      .cmp-head{font-size:58px;font-weight:800;text-align:center;color:var(--ink);margin:0 0 50px}
      .cmp-cols{display:flex;align-items:center;justify-content:center;gap:50px}
      .cmp-col{flex:1;background:#ffffff08;border:1px solid #ffffff14;border-radius:24px;padding:44px}
      .cmp-title{font-size:46px;font-weight:800;border-bottom:4px solid;padding-bottom:18px;margin-bottom:26px}
      .cmp-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px}
      .cmp-col li{font-size:40px;color:var(--ink);font-weight:500}
      .cmp-vs{font-size:90px;font-weight:900}

      /* bars */
      .bar-wrap{width:100%;max-width:1500px}
      .bar-head{font-size:58px;font-weight:800;color:var(--ink);margin:0 0 56px}
      .bar-list{display:flex;flex-direction:column;gap:40px}
      .bar-row{display:flex;align-items:center;gap:30px}
      .bar-label{width:280px;font-size:40px;font-weight:700;color:var(--dim);word-break:keep-all;overflow-wrap:anywhere}
      .bar-track{flex:1;height:60px;background:#ffffff10;border-radius:14px;overflow:hidden}
      .bar-fill{height:100%;border-radius:14px}
      .bar-val{width:200px;font-size:48px;font-weight:800;color:var(--ink);text-align:right}

      /* cta */
      .cta-wrap{text-align:center;max-width:1500px}
      .cta-rule{width:160px;height:10px;border-radius:5px;margin:0 auto 44px}
      .cta-line{font-size:62px;font-weight:600;color:var(--dim);line-height:1.25}
      .cta-strong{font-size:96px;font-weight:900;color:var(--ink);margin-bottom:18px;letter-spacing:-.03em}
    </style>
  </head>
  <body>
    <div id="master-root" data-composition-id="master" data-width="${THEME.width}" data-height="${THEME.height}" data-start="0" data-duration="${total}">
      <audio id="narration" class="clip" data-start="0" data-duration="${total}" data-volume="1" data-track-index="0" src="audio/narration.wav"></audio>

${sceneHtml}

${captionHtml}

      <script>
        window.__timelines = window.__timelines || {};
        var tl = gsap.timeline({ paused: true });

${indent(animJs, 8)}

        window.__timelines["master"] = tl;
      </script>
    </div>
  </body>
</html>
`;
}

function indent(s, n) {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}
