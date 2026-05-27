#!/usr/bin/env python
"""Coqui XTTS-v2 배치 합성 워커.

JSON 매니페스트를 받아 모델을 한 번만 로드하고 여러 라인을 순차 합성한다.
narrate.mjs 가 라인별 모델 로드 비용을 피하기 위해 사용한다.

사용:
    python lib/xtts/synth.py manifest.json

manifest.json 스키마:
    {
      "language": "ko",
      "speaker": "Claribel Dervla",    # (선택) XTTS-v2 빌트인 스피커명
      "speed": 1.0,                      # (선택) 0.5~1.5
      "items": [ { "text": "...", "output": "/abs/path/out.wav" }, ... ]
    }

stdout 에 JSON 라인으로 진행 상황을 흘리고, 마지막에 {"status":"ok"} 또는
{"status":"error","message":"..."} 를 출력한다. 비결정적 환경에 의존하지 않도록
COQUI_TOS_AGREED 를 자동 세팅한다.
"""
import json
import os
import sys
import warnings

# 라이선스 클릭스루 동의는 매니페스트 사용자(=이 저장소 운영자)가 책임진다.
os.environ.setdefault("COQUI_TOS_AGREED", "1")
warnings.filterwarnings("ignore")  # FutureWarning 등 노이즈 억제

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def main():
    if len(sys.argv) < 2:
        emit({"status": "error", "message": "manifest path required"})
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        manifest = json.load(f)

    items = manifest.get("items", [])
    lang = manifest.get("language", "ko")
    speaker = manifest.get("speaker") or "Claribel Dervla"
    speed = float(manifest.get("speed", 1.0))

    try:
        from TTS.api import TTS  # noqa: import-after-env
    except Exception as e:
        emit({"status": "error", "message": f"import TTS failed: {e}"})
        return 3

    emit({"event": "loading", "model": "xtts_v2"})
    try:
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
    except Exception as e:
        emit({"status": "error", "message": f"model load failed: {e}"})
        return 4

    # 유효 스피커 검증/폴백 (오타·구버전 호환)
    speakers = list(tts.speakers or [])
    if speaker not in speakers and speakers:
        emit({"event": "speaker_fallback", "requested": speaker, "using": speakers[0]})
        speaker = speakers[0]

    emit({"event": "ready", "speaker": speaker, "language": lang, "speed": speed, "count": len(items)})

    for i, it in enumerate(items):
        text = it.get("text", "")
        out = it.get("output")
        if not (text and out):
            emit({"event": "skip", "index": i, "reason": "missing text or output"})
            continue
        try:
            tts.tts_to_file(
                text=text,
                speaker=speaker,
                language=lang,
                file_path=out,
                speed=speed,
            )
            emit({"event": "done", "index": i, "output": out})
        except Exception as e:
            emit({"status": "error", "index": i, "message": str(e)[:300]})
            return 5

    emit({"status": "ok", "synthesized": len(items)})
    return 0

if __name__ == "__main__":
    sys.exit(main())
