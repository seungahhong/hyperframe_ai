# Hyperframe AI

링크(유튜브 영상 / 기술 블로그) 하나를 넣으면 **자막·본문 요약 → AI 내레이션(TTS) →
동기화 자막 → 모션그래픽 컴포지션(HTML) → MP4 렌더**까지 자동으로 만들어 주는
"얼굴 없는(faceless)" 설명 영상 제작 파이프라인입니다.

[HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)("HTML을 쓰면 영상이 렌더된다")를
기반으로 하며, 코드팩토리 *"Hyperframe + AI로 따봉 영상 만드는법"* 의 방법론을 코드로 옮겼습니다.

```
링크/파일 ─▶ ① 인제스트 ─▶ ② 요약 ─▶ ③ 내레이션 ─▶ ④ 컴포지션 ─▶ ⑤ 렌더 ─▶ 🎬 MP4
            (자막/본문 추출)  (씬 스크립트)  (TTS+타이밍)  (모션그래픽 HTML)   (영상)
```

> macOS 환경을 기준으로 합니다. (한국어 내레이션이 macOS `say -v Yuna` 음성을 사용합니다.)

---

## 1. 처음 한 번만 — 환경 설정

영상 제작에는 아래 4가지 도구가 필요합니다. 이미 있는 것은 건너뛰어도 됩니다.

### 1-1. Node.js (22 이상)

```bash
node --version    # v22 이상이면 OK
```

없거나 버전이 낮다면 [nodejs.org](https://nodejs.org) 에서 설치하거나, Homebrew로:

```bash
brew install node
```

### 1-2. FFmpeg (오디오 합성·길이 측정에 필수)

`ffmpeg` 과 `ffprobe` 두 명령이 모두 설치됩니다.

```bash
brew install ffmpeg
```

### 1-3. uv / uvx + deno (유튜브 자막 다운로드용)

> 유튜브(`--type youtube`) 입력을 쓸 때만 필요합니다. SRT·블로그·직접 작성 스크립트만 쓴다면 생략 가능.

`uvx`는 `yt-dlp` 런처이고, **deno** 는 yt-dlp가 YouTube의 JS 챌린지(서명·n-challenge)를
풀 때 필요한 런타임입니다. 둘 다 없으면 유튜브 자막을 받지 못합니다(`Requested format is not available`).

```bash
brew install uv deno
# 또는: curl -LsSf https://astral.sh/uv/install.sh | sh
#       curl -fsSL https://deno.land/install.sh | sh
```

### 1-4. 한국어 음성 "Yuna" 활성화 (macOS 내장)

macOS의 `say` 명령은 기본 제공되지만, **한국어 Yuna 음성은 직접 내려받아야** 할 수 있습니다.

1. **시스템 설정 → 손쉬운 사용 → 콘텐츠 말하기 → 시스템 음성 → 음성 관리**
2. **한국어 → Yuna** 를 체크해 다운로드
3. 설치 확인:

```bash
say -v '?' | grep Yuna        # Yuna 가 보이면 OK
say -v Yuna "안녕하세요, 테스트입니다."   # 소리가 나면 정상
```

> ⚠️ macOS의 신형(프리미엄) 한국어 음성은 `say`로 합성 시 무음이 나오는 경우가 있습니다.
> **반드시 `Yuna`** 를 사용하세요. (영어/일어/중국어는 HyperFrames 내장 Kokoro 음성을 자동 사용)

### 1-5. (선택) 고품질 요약을 위한 Claude API 키

요약 단계는 **API 키가 있으면 Claude로 고품질 씬 구성**을, 없으면 규칙 기반 추출식 폴백을 씁니다.
키가 없어도 동작하지만, 결과 품질 차이가 큽니다. 키가 있다면 환경변수로 등록하세요.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # ~/.zshrc 등에 넣어두면 편합니다
```

### 1-6. 의존성 — 별도 설치 불필요

HyperFrames CLI는 실행 시 `npx`로 자동으로 받아옵니다(첫 실행 시 인터넷 필요).
이 저장소 자체는 빌드 단계가 없는 순수 ESM이므로 `npm install` 도 필요 없습니다.

### ✅ 한 번에 점검하기

모든 도구가 준비됐는지 한 줄로 확인합니다.

```bash
node pipeline/doctor.mjs
```

```
✅  Node                       v22.x
✅  FFmpeg                     ffmpeg version ...
✅  ffprobe                    ffprobe version ...
✅  macOS say (한국어 TTS)     ...
✅  uvx (yt-dlp 런처)          ...
모든 도구 준비 완료.
```

❌ 가 있으면 위 해당 단계로 돌아가 설치하세요.

---

## 2. 첫 영상 만들기 (5분)

저장소에 포함된 예제 자막으로 바로 한 편 만들어 봅니다.

```bash
node pipeline/run.mjs --type srt --file assets/transcripts/reference-tutorial.ko.srt --name first-video
```

진행 단계가 순서대로 출력되고, 끝나면 영상이 만들어집니다:

```
✅ 영상 생성 완료: projects/first-video/out/first-video.mp4
```

> 처음엔 `--quality draft` 로 빠르게 확인하고, 마음에 들면 `standard`/`high` 로 다시 렌더하는 것을 권장합니다.

---

## 3. 사용법 — 4가지 입력 방식

`node pipeline/run.mjs` 에 입력 종류를 지정해 실행합니다. `--name` 은 산출물 폴더 이름입니다(생략 시 제목으로 자동 생성).

```bash
# ① 유튜브 영상 → 요약 영상  (자막을 yt-dlp로 받아옴, uvx 필요)
node pipeline/run.mjs --type youtube --url "https://youtu.be/<id>" --lang ko --name my-vid

# ①-b 자막이 공개돼 있지 않을 때 — 로그인 쿠키로 실시간/자동 자막 접근
node pipeline/run.mjs --type youtube --url "https://youtu.be/<id>" --cookies-from-browser chrome --name my-vid

# ② 기술 블로그 글 → 요약 영상  (URL 본문을 추출)
node pipeline/run.mjs --type blog --url "https://blog.example.com/post" --lang ko --name my-vid

# ③ 로컬 자막(SRT) → 요약 영상
node pipeline/run.mjs --type srt --file path/to/subs.ko.srt --name my-vid

# ④ 직접 작성한 스크립트 → 영상  (요약 단계 생략, 4번 참조)
node pipeline/run.mjs --script projects/my-vid/script.json --name my-vid
```

### 옵션

| 옵션 | 값 | 설명 |
| --- | --- | --- |
| `--name` | 문자열 | 산출물 폴더명 `projects/<name>/` |
| `--lang` | `ko`(기본)·`en`·`ja`·`zh` | 요약·내레이션 언어 |
| `--quality` | `draft`·`standard`(기본)·`high` | 렌더 화질 |
| `--fps` | `24`·`30`(기본)·`60` | 프레임레이트 |
| `--no-render` | (플래그) | MP4를 굽지 않고 미리보기까지만 |
| `--voice` | 예: `Yuna` | 내레이션 음성 강제 지정 |
| `--rate` | 숫자(wpm) | 말 속도. 낮을수록 천천히 (기본 165, 한국어는 150 권장) |
| `--pitch` | 숫자 | 음높이. `<1`이면 톤을 낮춰 따뜻하게 (예: `0.90`) |
| `--topic` | 문자열 | 요약 시 주제 힌트 |
| `--cookies-from-browser` | `chrome`·`safari`·`edge`·`firefox` | (유튜브) 로그인 쿠키로 비공개/실시간 자막 접근 |
| `--cookies` | `cookies.txt` 경로 | (유튜브) Netscape 형식 쿠키 파일 사용 |

> 유튜브 자막이 익명으로 잡히지 않을 때(로그인·멤버십·라이브 자동 자막 등), 쿠키를 주면
> **익명 시도 실패 후 쿠키로 자동 재시도**합니다. `--cookies` 파일이 `--cookies-from-browser`보다 우선합니다.
> Safari는 터미널에 "전체 디스크 접근 권한"이, Chrome은 일부 환경에서 키체인 접근이 필요할 수 있습니다.

> 음성 톤은 `--rate 150 --pitch 0.90` 조합이 차분하고 따뜻한 한국어 내레이션에 잘 맞습니다.
> script.json의 `meta.rate`/`meta.pitch` 로도 지정할 수 있으며, CLI 옵션이 우선합니다.

### 미리보기

렌더 전후로 브라우저에서 모션그래픽을 확인할 수 있습니다(HyperFrames 스튜디오 서버).

```bash
node pipeline/preview.mjs my-vid     # Ctrl+C 로 종료
```

### 산출물 위치

```
projects/<name>/
  script.json       # 씬 스크립트(요약 결과 또는 직접 작성한 입력)
  transcript.json   # 자막/씬 타이밍(자동 생성)
  audio/narration.wav
  index.html        # HyperFrames 컴포지션
  out/<name>.mp4    # ★ 최종 영상
```

> ⚠️ `projects/` 폴더는 통째로 `.gitignore` 대상입니다(동적 산출물).
> 직접 작성한 `script.json` 을 보존하려면 별도 위치에 백업하세요.

---

## 4. 스크립트를 직접 작성하기 (선택)

요약 결과가 마음에 안 들거나, 내용을 직접 통제하고 싶다면 `script.json` 을 손으로 쓰면 됩니다.
가장 결과 품질이 좋은 방식입니다. 아래 스키마로 `projects/<name>/script.json` 을 만든 뒤
`--script` 로 실행하세요.

```jsonc
{
  "meta": {
    "title": "제미나이 3.5",
    "subtitle": "가장 강력한 에이전트·코딩 모델",
    "lang": "ko",                  // ko | en | ja | zh
    "voice": "Yuna",
    "rate": 150,                   // (선택) 말 속도 wpm
    "pitch": 0.9                   // (선택) <1 이면 따뜻한 톤
  },
  "scenes": [
    {
      "heading": "제미나이 3.5",
      "visual": "title",           // 아래 표 참조
      "data": { "title": "제미나이 3.5", "subtitle": "..." },
      "lines": [                   // 내레이션 = 화면 자막. 짧은 구어체 문장.
        "구글이 제미나이 3.5를 공개했습니다.",
        "핵심만 빠르게 정리할게요."
      ]
    }
    // ... 5~7개 씬 권장. 첫 씬은 title, 마지막 씬은 cta 를 추천.
  ]
}
```

`id` 와 `start`/`end`/`duration` 은 실행 시 자동으로 채워지므로 적지 않아도 됩니다.
실제 예시는 `projects/google-keynote/script.json` 을 참고하세요.

### 시각 연출 타입 (`visual`)

| visual | `data` 예시 | 연출 |
| --- | --- | --- |
| `title` | `{ "title", "subtitle" }` | 타이틀 슬라이드업 |
| `list` | `{ "items": ["...", "..."] }` | 번호 항목 순차 등장 |
| `compare` | `{ "left": {"title","points":[]}, "right": {"title","points":[]} }` | 좌/우 카드 비교 |
| `stat` | `{ "value": "4배", "caption": "...", "sub": "..." }` | 큰 수치 강조 |
| `bars` | `{ "unit": "%", "items": [{"label","value"}] }` | 막대 그래프 |
| `cta` | `{}` (`lines` 사용) | 마무리 강조 문구 |

---

## 5. 동작 원리 (요약)

| 단계 | 모듈 | 하는 일 |
| --- | --- | --- |
| ① 인제스트 | `pipeline/ingest.mjs` | 유튜브 자막(yt-dlp)·블로그 본문·SRT에서 원문 텍스트 추출 |
| ② 요약 | `pipeline/summarize.mjs` | 원문 → 씬 스크립트. `ANTHROPIC_API_KEY` 있으면 Claude, 없으면 추출식 폴백 |
| ③ 내레이션 | `pipeline/narrate.mjs` | 자막 line 단위 TTS → `ffprobe`로 길이 측정 → `narration.wav` + 타이밍 |
| ④ 컴포지션 | `pipeline/compose.mjs` | 스크립트+타이밍 → HyperFrames `index.html`(GSAP 모션·동기화 자막) |
| ⑤ 렌더 | `pipeline/render.mjs` | `npx hyperframes render` → MP4 (`lint`/`snapshot` 헬퍼 포함) |

> "자막 line별로 TTS를 만들어 실제 길이를 측정"하기 때문에 오디오와 화면 모션이 정확히 동기화됩니다.
> 데이터 스키마·내부 동작·설계 함정은 [`_docs/architecture.md`](_docs/architecture.md) 에 자세히 있습니다.

---

## 6. 자주 겪는 문제

| 증상 | 원인 / 해결 |
| --- | --- |
| `say` 한국어가 무음 | 신형 음성 사용 중. **`Yuna`** 로 지정(`--voice Yuna`). 1-4 참고 |
| `Yuna` 가 없다고 나옴 | 시스템 설정에서 한국어 Yuna 음성 다운로드 (1-4) |
| 유튜브 "자막을 찾지 못했습니다" | 익명으로 자막이 없음. `--cookies-from-browser chrome`(로그인 자막) 또는 다른 언어(`--lang en`)로 시도하거나 SRT 직접 사용 |
| 유튜브 `Requested format is not available` | yt-dlp의 JS 런타임 누락. `brew install deno` 후 재시도 (1-3 참고) |
| `ffprobe`/`ffmpeg` 없음 | `brew install ffmpeg` |
| 요약 품질이 낮음 | `ANTHROPIC_API_KEY` 설정(1-5) 또는 `script.json` 직접 작성(4번) |
| 렌더가 느림 | 먼저 `--quality draft` 로 확인 후 `standard`/`high` 재렌더 |
| 숫자 카운트업이 안 보임 | seek 렌더 한계. 속성 보간으로만 연출 (architecture.md §함정 참고) |

### 환경변수

| 변수 | 용도 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 고품질 요약(Claude API) 활성화 |
| `HF_LLM_MODEL` | 요약 모델 변경 (기본 `claude-sonnet-4-6`) |
| `HF_TTS_BACKEND` | TTS 백엔드 강제 (`say` \| `kokoro`) |
| `HF_YT_COOKIES` | (유튜브) 쿠키 파일 경로 — CLI `--cookies` 미지정 시 폴백 |
| `HF_YT_COOKIES_FROM_BROWSER` | (유튜브) 쿠키 추출 브라우저 — CLI 미지정 시 폴백 |

---

## 더 보기

- **방법론·함정·HyperFrames 작성 규칙** → `.claude/skills/video-production-guide/SKILL.md`
- **데이터 스키마·모듈 내부·비주얼 타입** → [`_docs/architecture.md`](_docs/architecture.md)
- **프로젝트 컨벤션·취약 규칙** → [`CLAUDE.md`](CLAUDE.md)
- **HyperFrames 문서** → `npx hyperframes docs <topic>` · <https://hyperframes.heygen.com/llms.txt>
