# CLAUDE.md — Hyperframe AI

> 링크(유튜브/기술 블로그) → 자막·본문 **요약** → AI **내레이션(TTS)** → 동기화 **자막** +
> **모션그래픽(HTML)** → **MP4** 로 만드는 영상 자동 제작 파이프라인.
> [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)("HTML을 쓰면 영상이 렌더") 기반,
> 코드팩토리 *"Hyperframe + AI로 따봉 영상 만드는법"* 의 방법론을 코드로 옮긴 것.

## 빠른 명령

```bash
node pipeline/doctor.mjs                                          # 환경 점검
node pipeline/run.mjs --type youtube --url <URL> --lang ko --name <n>
node pipeline/run.mjs --type youtube --url <URL> --cookies-from-browser chrome --name <n>  # 로그인 자막
node pipeline/run.mjs --type blog   --url <URL> --lang ko --name <n>
node pipeline/run.mjs --type srt    --file <path.srt>  --name <n>
node pipeline/run.mjs --script projects/<n>/script.json --name <n>   # 사전 작성 스크립트
node pipeline/preview.mjs <n>                                     # 브라우저 미리보기
# 공통 옵션: --quality draft|standard|high · --fps 24|30|60 · --no-render · --lang ko|en|ja|zh
# 음성 톤: --voice <name> · --rate <wpm> · --pitch <0.85~1.15>
# YouTube 인증: --cookies <cookies.txt> | --cookies-from-browser chrome|safari|edge|firefox
# 재수집 강제: --refresh   (raw.json/script.json 캐시 무시)
```

산출물: `projects/<n>/out/<n>.mp4` (※ `projects/` 는 `.gitignore`로 제외)

## 구조

```
pipeline/  ingest → summarize → narrate → compose → render   (오케스트레이터: run.mjs)
lib/       tts.mjs(edge↔say↔kokoro↔xtts) · srt.mjs · util.mjs
           xtts/    (선택) Coqui XTTS-v2 venv·워커 — `bash lib/xtts/setup.sh`
templates/ theme.mjs        # 공통 톤/색/폰트/캔버스
projects/  <n>/             # 프로젝트별 산출물(git 제외)
              raw.json      # 인제스트 본문 캐시(있으면 인제스트 스킵)
              script.json   # 요약 결과 캐시(있으면 요약 스킵)
assets/    transcripts/     # 원본 자막
.claude/skills/video-production-guide/   # 영상 제작 가이드 스킬
```

각 단계의 입출력·데이터 스키마·비주얼 타입은 **`_docs/architecture.md`** 참조.

## ⚠️ 깨지기 쉬운 규칙 (반드시 지킬 것)

1. **seek 렌더는 GSAP `onUpdate` 콜백을 억제한다.** 콜백으로 DOM을 바꾸는 연출(숫자 카운트업)은
   화면에 안 나온다. → `width`/`scale`/`opacity` 등 **속성 보간**으로만 연출.
2. **`class="clip"` 자동 가시성에 의존하지 마라.** 풀스크린 씬이 겹쳐 남는다. → 씬·자막 표시는
   master 타임라인의 **인라인 토글**(`tl.set("#id",{display:...}, t)`)로 직접 제어. 기본 CSS는 `display:none`.
3. **타이밍은 추정하지 말고 측정하라.** 자막 line 단위 TTS → `ffprobe` 측정 → 누적.
   인접 자막은 경계에서 ~0.06s 띄워 `overlapping_clips_same_track` 회피.
4. **한국어 TTS 기본은 Microsoft Edge TTS** (`ko-KR-SunHiNeural`). `say -v Yuna`(오프라인) 와
   `xtts`(오프라인 Coqui, 사전 셋업) 는 폴백. `HF_TTS_BACKEND=edge|say|xtts|kokoro` 로 강제 가능.
   Kokoro 는 한국어 미지원. 폰트 스택에 `Noto Sans KR` 포함.
5. **요약 우선순위**: Ollama(기본 `gemma4:26b`) → Claude API(`ANTHROPIC_API_KEY`) → 추출식 폴백.
   Ollama 호출은 NDJSON 스트리밍으로 undici 기본 timeout(5분)을 회피하고, JSON 파싱 실패 시
   같은 모델 다른 시드 → `gemma4:e4b` 로 자동 폴백한다(큰 모델의 token-repetition loop 회피).
   summarize 결과는 `normalizeData()` 로 정규화해 compose 의 `[object Object]` 표시를 막는다.
6. **인트로 카드(2.5s)**: `narrate.mjs` 의 `INTRO` 상수로 영상 맨 앞에 정적 카드를 둔다.
   `scenes[0].start = INTRO`, `transcript.intro` 노출, compose 가 이 값을 읽어 `#intro-card`
   를 `[0, INTRO]` 구간에 표시한다.
7. **캐시 정책**: `projects/<n>/raw.json`(인제스트 결과)·`script.json`(요약 결과)이 있으면 해당
   단계 스킵. YouTube 429/Ollama 실패 등 재시도 시 무거운 단계를 반복하지 않게 설계.
   재수집·재요약을 강제하려면 `--refresh`.

## 컨벤션

- Node ≥ 22, **순수 ESM(.mjs)**, 빌드 단계 없음.
- **결정적 코드 규칙은 compose/render 에만 적용**: `Date.now()`/`Math.random()`/네트워크 fetch 금지.
  ingest/summarize/narrate 는 본질적으로 네트워크·시간 의존이라 허용(다만 결과는 디스크에 캐시).
- 컴포지션 변경 후 **항상**: `npx hyperframes lint`(0 errors) → `npx hyperframes snapshot`(눈 검증) → `render`.
- 새 비주얼 타입 추가는 `compose.mjs`의 `renderVisual` 분기 + `theme.mjs` 토큰 사용.
- 새 TTS 백엔드는 `lib/tts.mjs` 에 `synth*` 함수 + `pickBackend()` 분기. 모델 로드가 비싼 백엔드(XTTS)는
  `synthLines()` 배치 경로를 구현해 라인별 워밍업을 피한다.
- 커밋은 git-harness `/commit` 사용.

## 더 보기

- **사용법 상세** → `README.md`
- **방법론·함정·HyperFrames 작성 규칙** → `.claude/skills/video-production-guide/SKILL.md`
- **데이터 스키마·모듈 내부·비주얼 타입** → `_docs/architecture.md`
- HyperFrames 문서 → `npx hyperframes docs <topic>` · `https://hyperframes.heygen.com/llms.txt`
