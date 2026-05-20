---
name: video-production-guide
description: HyperFrames + AI로 "얼굴 없는" 모션그래픽 설명 영상을 제작하는 가이드. 영상/기술 블로그 링크를 받아 자막·본문을 요약하고, AI 내레이션(TTS)과 동기화된 자막, 모션그래픽을 HTML로 작성해 MP4로 렌더한다. 코드팩토리 "Hyperframe + AI로 따봉 영상 만드는법" 영상의 방법론과, 실제 구현에서 검증된 함정(seek 렌더, 타이밍 동기화, 한국어 TTS)을 담았다. 사용 시점: 영상 제작, hyperframe/하이퍼프레임, 모션그래픽, faceless video, 영상 자동화, 자막→영상, 블로그→영상, AI 영상 편집, video composition을 언급할 때.
---

# 영상 제작 가이드 — HyperFrames + AI

코드 한 줄 안 쓰던 사람도 **AI에게 시켜서** 화면 가득 모션그래픽이 들어간
"얼굴 없는" 설명 영상(AI테크 채널 스타일)을 만들 수 있게 하는 워크플로우.
출처: 코드팩토리 *"Hyperframe + AI로 따봉 영상 만드는법"* + 본 저장소의 파이프라인 구현.

이 저장소(`hyperframe_ai`)에 **레퍼런스 구현**이 있다:
`pipeline/`(ingest→summarize→narrate→compose→render), `templates/theme.mjs`(공통 톤),
`projects/`(프로젝트별 산출물). 새 영상은 `node pipeline/run.mjs ...` 한 줄로 만든다.

---

## 1. HyperFrames 멘탈 모델

> **픽셀을 생성하지 말고, HTML을 작성하라.** AI는 HTML/CSS/JS를 쓰고,
> 헤드리스 크롬이 프레임 단위로 캡처해 FFmpeg로 MP4를 만든다. (Remotion의 오픈소스 대안)

- 컴포지션 = `data-composition-id`/`data-width`/`data-height`/`data-duration`을 가진 `<div>`.
- 애니메이션 = GSAP 타임라인을 **`paused:true`로 만들고 `window.__timelines["master"]`에 등록**.
- 타이밍 요소 = `data-start`/`data-duration`/`data-track-index`. 가시 요소엔 `class="clip"`.
- **결정적(deterministic)이어야 함**: `Date.now()`/`Math.random()`/네트워크 fetch 금지. 같은 입력 = 같은 출력.
- 요구사항: Node ≥ 22, FFmpeg. CLI: `init` / `preview` / `lint` / `snapshot` / `render` / `tts` / `transcribe` / `capture`.

빠른 참조: `npx hyperframes docs <data-attributes|gsap|compositions|rendering>` · 전체 문서 인덱스 `https://hyperframes.heygen.com/llms.txt`

---

## 2. 워크플로우 (영상 1편 만들기)

```
링크/주제 → ① 기획(Plan) → ② 자료 수집·맥락화 → ③ 스크립트(씬 분해)
        → ④ 내레이션 + 자막(같은 컨텍스트) → ⑤ 컴포지션 작성
        → ⑥ 자가 검증 루프 → ⑦ 렌더 → ⑧ 루프 닫고 문서화
```

1. **Plan 모드로 시작.** 내가 **반드시 정할 것**(폴더 구조, 보이스 유무, 톤)은 명확히 지시하고,
   AI가 정해도 되는 것은 *"그건 네가 정해"* 라고 위임한다. 여러 프로젝트를 한 저장소에서 관리하도록 폴더 구조부터 잡는다.
2. **자료 수집.** 영상이면 자막을 받고(`yt-dlp`/`hyperframes transcribe`), 블로그면 본문을 추출(`hyperframes capture`).
3. **스크립트 = 기획서.** 개요 → 씬별 (스크립트 + 모션그래픽 요소 + 레이아웃/강조)로 분해. 한 씬에 메시지 하나.
4. **내레이션 + 자막.** 음성을 만들고(직접 녹음 또는 TTS), **언제 무슨 말을 하는지 타이밍**을 만든다. 4번 레슨 참고.
5. **컴포지션 작성.** 씬별 모션그래픽을 HTML+GSAP로. `data-*` 규칙과 §3 함정을 지킨다.
6. **자가 검증 루프.** `snapshot`으로 키프레임 PNG를 떠서 *AI가 직접 결과를 보고* 의도대로 됐는지 확인·수정.
7. **렌더.** `render`로 MP4. 초안은 `-q draft`, 최종은 `standard`/`high`.
8. **루프 닫고 문서화.** 시행착오를 메모리/룰 파일에 적어 **다음 영상은 한 번에** 나오게 한다.

---

## 3. ⚠️ 반드시 아는 함정 (구현하며 검증됨)

이 4가지를 모르면 영상이 **조용히 깨진다**(렌더는 되는데 화면이 틀림).

1. **seek 렌더는 GSAP `onUpdate` 콜백을 억제한다.**
   HyperFrames는 프레임마다 타임라인을 *seek*하며 캡처하는데, 이때 `onUpdate`/`onComplete` 같은 콜백이 호출되지 않는다.
   → **숫자 카운트업처럼 `onUpdate`로 DOM을 바꾸는 연출은 화면에 안 나온다.**
   해결: 콜백 대신 **속성 보간**(width/scale/opacity/transform)으로 연출하라. 카운트업이 꼭 필요하면 최종 수치를 두고 스케일/페이드로 강조.
   (막대 그래프의 `width` 애니메이션은 속성 보간이라 정상 동작한다.)

2. **`class="clip"` 자동 가시성에만 의존하지 마라.**
   여러 풀스크린 씬을 한 파일에 겹쳐 두면 윈도우 밖에서도 안 숨겨져 **이전 씬이 다음 씬 위에 남는다**.
   해결: 씬·자막 표시를 **master 타임라인의 인라인 토글**로 직접 제어한다(인라인 스타일이 우선순위 최상):
   ```js
   tl.set("#scene-2", { display: "flex" }, START);
   tl.set("#scene-2", { display: "none" }, END);   // 마지막 씬은 hide 생략
   ```
   기본 CSS는 `display:none`으로 두고 타임라인이 켠다. (공식 captions 샘플과 동일한 방식)

3. **타이밍은 추정하지 말고 측정하라.**
   "자막 line 단위로 TTS를 합성 → `ffprobe`로 길이 측정 → 누적"하면 Whisper 추정 없이 오디오와 모션이 **정확히** 맞는다.
   인접 자막은 경계에서 살짝(≈0.06s) 띄워 `overlapping_clips_same_track` 에러를 피한다.

4. **한국어 TTS는 Kokoro가 아니라 macOS `say`.**
   `hyperframes tts`(Kokoro-82M)는 en/ja/zh/es/fr/hi/it/pt만 지원(**한국어 없음**).
   → 한국어는 `say -v Yuna -o out.aiff -f line.txt` 후 `ffmpeg`로 WAV 정규화. 언어별로 백엔드를 분기하라.
   폰트도 주의: 렌더 시 `Noto Sans KR`는 자동 페치되어 결정적으로 렌더되지만, Pretendard 등은 매핑이 없어 폴백된다. 폰트 스택에 `Noto Sans KR`를 포함하라.

---

## 4. 핵심 레슨 (방법론)

1. **AI를 나와 같은 컨텍스트에 두라.** 내가 보는 것(영상/스크린샷/음성)을 AI도 보게 하라.
   음성을 던졌으면 **자막+타이밍**으로 "몇 초에 무슨 말"인지 알려줘야 모션과 싱크가 맞는다. → AX(AI Experience)가 좋은 도구를 골라라.
2. **한 번에 끝낼 거라 기대하지 마라.** 반복해서 깎는 게 소프트웨어 엔지니어링이다. Plan은 충분히 다듬을수록 좋다.
3. **수정한 코드 ≠ 결과물.** 작은 코드 변경이 빌드된 결과를 크게 바꿀 수 있다. 결과를 AI에게 *보여주고* 스스로 검증하게 하라.
4. **자가 검증 루프를 만들어라.** 3개 게이트 권장 — ① 레이아웃 스냅샷(`snapshot`/스크린샷) ② 자막-타이밍 싱크 ③ 렌더 직전 E2E 확인.
   불평하지 말고 *AI가 스스로 확인할 루프*를 직접 깔아줘라(주니어 개발자 다루듯 쉐이핑).
5. **루프를 닫고 무한히 돌려라.** 첫 영상의 시행착오를 문서로 남기면, 둘째 영상부터는 순서대로 지시만 해도 한 번에 나온다.

---

## 5. 컴포지션 작성 규칙 (체크리스트)

- [ ] 루트: `<div id="master-root" data-composition-id="master" data-width data-height data-start="0" data-duration="TOTAL">`
- [ ] 모든 타이밍 요소에 `data-start`/`data-duration`/`data-track-index`, 가시 요소엔 `class="clip"`(단, §3-2 처럼 직접 토글하면 plain div + 타임라인 제어)
- [ ] GSAP는 `gsap.timeline({paused:true})` → `window.__timelines["master"]=tl`
- [ ] 내레이션은 `<audio data-start data-duration data-volume src="audio/narration.wav">` 한 트랙
- [ ] 편집/디버깅을 위해 타임라인 요소엔 안정적인 `id` 부여(Studio editable id 경고 제거)
- [ ] 변경 후 **항상** `npx hyperframes lint` (0 errors 확인) → `snapshot`으로 눈으로 확인 → `render`

## 6. 명령어

```bash
npx hyperframes init <name> --example swiss-grid --tailwind   # 스캐폴드
npx hyperframes preview            # 브라우저 미리보기(장시간 서버 → 백그라운드 실행)
npx hyperframes lint               # 검증(0 errors 목표)
npx hyperframes snapshot --at 2.5,10,21   # 키프레임 PNG(자가 검증)
npx hyperframes render -f 30 -q standard -o out/video.mp4   # MP4
npx hyperframes transcribe <a/v>   # 단어 단위 타임스탬프(Whisper)
npx hyperframes tts "<text>" -v af_heart -l en-us -o a.wav  # 비한국어 TTS(Kokoro)
npx hyperframes capture <url>      # 웹페이지 캡처(블로그→영상)
```

## 7. 이 저장소 파이프라인으로 바로 만들기

```bash
node pipeline/run.mjs --type youtube --url "https://youtu.be/<id>" --lang ko --name my-vid
node pipeline/run.mjs --type blog --url "https://blog/post" --lang ko --name my-vid
node pipeline/run.mjs --type srt --file assets/transcripts/x.ko.srt --name my-vid
node pipeline/run.mjs --script projects/<name>/script.json --name <name>   # 사전 작성 스크립트
# 옵션: --quality draft|standard|high  --fps 24|30|60  --no-render
```

내레이션 품질을 높이려면 `ANTHROPIC_API_KEY`를 설정(요약 단계가 Claude API로 고품질 씬을 생성, 프롬프트 캐시 사용)하거나,
요약 단계를 에이전트(나)가 직접 작성한 `script.json`으로 대체한다(권장 — 가장 자연스러운 결과).
