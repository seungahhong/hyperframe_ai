# 아키텍처 & 데이터 레퍼런스

`CLAUDE.md`의 상세 부록. 파이프라인 내부 동작, 데이터 스키마, 비주얼 타입을 다룬다.

## 데이터 흐름

```
링크/파일 ─▶ ingest ─▶ summarize ─▶ narrate ─▶ compose ─▶ render ─▶ MP4
                                  (run.mjs 오케스트레이션)
```

| 단계 | 모듈 | 입력 → 출력 | 핵심 |
| --- | --- | --- | --- |
| 1 | `pipeline/ingest.mjs` | 링크/SRT → `{title, source, lang, text}` | youtube=yt-dlp(uvx), blog=fetch+본문추출, srt=파일. 롤링 자막 중복은 `lib/srt.mjs`가 병합 |
| 2 | `pipeline/summarize.mjs` | text → `script.json` | `ANTHROPIC_API_KEY` 있으면 Claude API(프롬프트 캐시), 없으면 추출식 폴백 |
| 3 | `pipeline/narrate.mjs` | script → `narration.wav` + `transcript.json` | 자막 line 단위 TTS → `ffprobe` 길이 측정 → 무음 갭과 함께 concat. 씬 타일링으로 start/duration 계산 |
| 4 | `pipeline/compose.mjs` | script+transcript → `index.html` 등 | 단일 master 컴포지션. 씬/자막은 타임라인 인라인 display 토글로 제어 |
| 5 | `pipeline/render.mjs` | 프로젝트 → `out/*.mp4` | `npx hyperframes render` 래퍼. `lint`/`snapshot` 헬퍼 포함 |

`lib/`: `tts.mjs`(say↔Kokoro 백엔드 분기), `srt.mjs`(파싱·중복병합), `util.mjs`(run/capture, `mediaDuration`, slug, esc).
`templates/theme.mjs`: 공통 색·폰트·캔버스(1920×1080·30fps)·캡션 스타일. 모든 프로젝트가 공유.

## `script.json` 스키마 (사람이 편집하는 입력)

```jsonc
{
  "meta": { "title", "subtitle", "lang"/*ko|en|ja|zh*/, "topic", "source", "voice"/*Yuna 등*/ },
  "scenes": [
    {
      "id": "scene-1",                 // 없으면 run 시 자동 부여
      "heading": "제목",
      "visual": "title|list|compare|stat|bars|cta",
      "data": { /* 비주얼별, 아래 참조 */ },
      "lines": ["내레이션이자 자막인 짧은 구어체 문장(12~22자)"]
      // start/end/duration 은 narrate 단계가 덧붙임(편집 불필요)
    }
  ]
}
```

## 비주얼 타입별 `data`

| visual | data 예시 | 연출 |
| --- | --- | --- |
| `title` | `{ "title", "subtitle" }` | 룰 라인 와이프 + 타이틀 슬라이드업 |
| `list` | `{ "items": ["...", "..."] }` | 번호 매긴 항목 stagger 등장 |
| `compare` | `{ "left": {"title","points":[]}, "right": {"title","points":[]} }` | 좌/우 카드 슬라이드 + 화살표 |
| `stat` | `{ "value": "15%", "caption": "...", "sub": "..." }` | 최종 수치 scale/fade(카운트업 X — §아래) |
| `bars` | `{ "unit": "%", "items": [{"label","value"}] }` | 막대 width 보간(최댓값 기준 정규화) |
| `cta` | `{}` (lines 사용) | 룰 라인 + 강조 문구 stagger |

## `transcript.json` (narrate 산출, 자동)

```jsonc
{
  "total": 44.72,                  // 총 길이(초)
  "audio": "audio/narration.wav",
  "lines":  [ { "sceneId", "text", "start", "end" } ],   // 자막 동기화용
  "scenes": [ { "id", "start", "duration" } ]            // 씬 타일링
}
```

## 왜 이렇게 했나 — 핵심 함정 상세

1. **seek 렌더 ↔ onUpdate**: HyperFrames는 프레임마다 타임라인을 seek하며 캡처하고, 이때 GSAP의 `onUpdate`/`onComplete` 콜백이 억제된다. 콜백으로 DOM 텍스트를 바꾸는 카운트업은 화면에 안 나온다(렌더 시 "0%"로 멈춤). → 속성 보간만 사용.
2. **clip 가시성**: `class="clip"` 자동 표시/숨김이 풀스크린 씬 겹침에서 신뢰성이 낮아 이전 씬이 남는다. → `tl.set("#id",{display:"flex"},start)` / `{display:"none"},end)` 로 인라인 제어(우선순위 최상). 기본 CSS는 `display:none`.
3. **타이밍 측정**: line 단위 TTS + `ffprobe`로 정확한 길이를 얻어 누적 → Whisper 추정 없이 싱크 일치. 인접 자막은 경계에서 ~0.06s 띄워 `overlapping_clips_same_track` 회피.
4. **한국어 TTS**: `hyperframes tts`(Kokoro-82M)는 en/ja/zh/es/fr/hi/it/pt만 지원(한국어 없음). → macOS `say -v Yuna` → AIFF → `ffmpeg`로 WAV(44.1k mono) 정규화. 렌더 폰트는 `Noto Sans KR`가 자동 페치되어 결정적으로 렌더되므로 폰트 스택에 포함.

## 검증 루프(권장)

```bash
npx hyperframes lint                       # 0 errors 목표
npx hyperframes snapshot --at 2.5,10,21    # 씬별 키프레임 PNG로 눈 검증
npx hyperframes render -q draft            # 초안 → 확인 후 standard/high
```
