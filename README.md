# Hyperframe AI

링크(유튜브 영상 / 기술 블로그)를 받아 **자막·본문을 요약 → AI 내레이션(TTS) → 동기화 자막 →
모션그래픽 컴포지션(HTML) → MP4 렌더**까지 자동으로 처리하는 영상 제작 파이프라인.

[HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)("HTML을 쓰면 영상이 렌더된다")를
기반으로 하며, 코드팩토리 *"Hyperframe + AI로 따봉 영상 만드는법"* 의 방법론을 코드로 옮겼다.

## 빠른 시작

```bash
node pipeline/doctor.mjs            # 환경 점검 (Node, FFmpeg, say, uvx)

# 유튜브 영상 → 요약 영상
node pipeline/run.mjs --type youtube --url "https://youtu.be/<id>" --lang ko --name my-vid

# 기술 블로그 → 요약 영상
node pipeline/run.mjs --type blog --url "https://blog/post" --lang ko --name my-vid

# 로컬 자막(SRT) → 요약 영상
node pipeline/run.mjs --type srt --file assets/transcripts/x.ko.srt --name my-vid

# 사전 작성 스크립트로 바로 제작 (요약 단계 생략)
node pipeline/run.mjs --script projects/<name>/script.json --name <name>
```

옵션: `--quality draft|standard|high` · `--fps 24|30|60` · `--no-render` · `--lang ko|en|ja|zh`

미리보기: `node pipeline/preview.mjs <name>` → 브라우저 스튜디오 · 산출물: `projects/<name>/out/<name>.mp4`

## 구조

```
pipeline/
  ingest.mjs     # 1. 링크/파일 → 원문 (yt-dlp / fetch / SRT)
  summarize.mjs  # 2. 원문 → 씬 스크립트(script.json) [Claude API 또는 추출식 폴백]
  narrate.mjs    # 3. 씬 → TTS 합성 + ffprobe 길이 측정 → narration.wav + transcript.json
  compose.mjs    # 4. 스크립트+타이밍 → HyperFrames 컴포지션(index.html, GSAP, 자막)
  render.mjs     # 5. npx hyperframes render → MP4 (+ lint / snapshot 헬퍼)
  run.mjs        # 오케스트레이터 (1→5)
lib/   tts.mjs(say/Kokoro 분기) · srt.mjs · util.mjs
templates/ theme.mjs   # 공통 톤/색/폰트
projects/<name>/        # 프로젝트별 산출물 (script/transcript/audio/index.html/out)
assets/transcripts/     # 원본 자막
.claude/skills/video-production-guide/  # 영상 제작 가이드 스킬
```

## 내레이션(TTS)

- **한국어**: macOS `say -v Yuna` (무료·오프라인). Kokoro는 한국어 미지원.
- **영어/일어/중국어 등**: `hyperframes tts`(Kokoro-82M).
- 타이밍: 자막 line 단위로 합성하고 `ffprobe`로 측정 → 모션그래픽과 정확히 싱크.

## 시각 연출 타입

`title` · `list` · `compare` · `stat` · `bars` · `cta` (씬의 `visual` 필드로 지정, `templates/theme.mjs` 톤 적용)

## 요구사항

Node ≥ 22 · FFmpeg · macOS(`say`, 한국어 TTS) · `uvx`(yt-dlp 런처). 자세한 함정·방법론은
`.claude/skills/video-production-guide/SKILL.md` 참고.
