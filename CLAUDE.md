# CLAUDE.md — Hyperframe AI

> 링크(유튜브/기술 블로그) → 자막·본문 **요약** → AI **내레이션(TTS)** → 동기화 **자막** +
> **모션그래픽(HTML)** → **MP4** 로 만드는 영상 자동 제작 파이프라인.
> [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)("HTML을 쓰면 영상이 렌더") 기반,
> 코드팩토리 *"Hyperframe + AI로 따봉 영상 만드는법"* 의 방법론을 코드로 옮긴 것.

## 빠른 명령

```bash
node pipeline/doctor.mjs                                          # 환경 점검
node pipeline/run.mjs --type youtube --url <URL> --lang ko --name <n>
node pipeline/run.mjs --type blog   --url <URL> --lang ko --name <n>
node pipeline/run.mjs --type srt    --file <path.srt>  --name <n>
node pipeline/run.mjs --script projects/<n>/script.json --name <n>   # 사전 작성 스크립트
node pipeline/preview.mjs <n>                                     # 브라우저 미리보기
# 옵션: --quality draft|standard|high · --fps 24|30|60 · --no-render · --lang ko|en|ja|zh
```

산출물: `projects/<n>/out/<n>.mp4` (※ `projects/` 는 `.gitignore`로 제외)

## 구조

```
pipeline/  ingest → summarize → narrate → compose → render   (오케스트레이터: run.mjs)
lib/       tts.mjs(say↔Kokoro) · srt.mjs · util.mjs
templates/ theme.mjs        # 공통 톤/색/폰트/캔버스
projects/  <n>/             # 프로젝트별 산출물(git 제외)
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
4. **한국어 TTS = macOS `say -v Yuna`** (Kokoro는 한국어 미지원). 폰트 스택에 `Noto Sans KR` 포함.

## 컨벤션

- Node ≥ 22, **순수 ESM(.mjs)**, 빌드 단계 없음. **결정적 코드**: `Date.now()`/`Math.random()`/네트워크 fetch 금지.
- 컴포지션 변경 후 **항상**: `npx hyperframes lint`(0 errors) → `npx hyperframes snapshot`(눈 검증) → `render`.
- 새 비주얼 타입 추가는 `compose.mjs`의 `renderVisual` 분기 + `theme.mjs` 토큰 사용.
- 커밋은 git-harness `/commit` 사용.

## 더 보기

- **사용법 상세** → `README.md`
- **방법론·함정·HyperFrames 작성 규칙** → `.claude/skills/video-production-guide/SKILL.md`
- **데이터 스키마·모듈 내부·비주얼 타입** → `_docs/architecture.md`
- HyperFrames 문서 → `npx hyperframes docs <topic>` · `https://hyperframes.heygen.com/llms.txt`
