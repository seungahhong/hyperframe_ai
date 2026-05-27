#!/usr/bin/env bash
# XTTS v2 한국어 TTS 환경 일괄 셋업.
# - venv: ~/.cache/hyperframe-ai/xtts-venv (Python 3.11)
# - 의존성: coqui-tts 0.24.1, transformers 4.40.2, torch<2.6, hangul_romanize
# - 모델: 첫 합성 시 자동 다운로드(~2GB) → ~/.cache/hyperframe-ai/xtts-models 권장
# 호환성 함정:
#   * coqui-tts 0.27+ ↔ transformers >=4.57 ↔ isin_mps_friendly 제거 → 0.24.1로 고정
#   * torch 2.6 ↔ weights_only=True 기본값 변경으로 XTTS 로드 실패 → <2.6 고정
#   * 한국어 합성은 hangul_romanize 필수
set -e
VENV="${HF_XTTS_VENV:-$HOME/.cache/hyperframe-ai/xtts-venv}"
MODELS="${HF_XTTS_HOME:-$HOME/.cache/hyperframe-ai/xtts-models}"

if ! command -v uv >/dev/null 2>&1; then
  echo "✗ uv 가 필요합니다. brew install uv 후 다시 실행하세요." >&2
  exit 1
fi

mkdir -p "$MODELS"
echo "▶ XTTS venv 위치: $VENV"
echo "▶ 모델 캐시: $MODELS"

if [ ! -d "$VENV" ]; then
  echo "▶ Python 3.11 venv 생성..."
  uv venv --python 3.11 "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
echo "▶ 의존성 설치 (코어, 큰 다운로드 가능)..."
uv pip install --quiet \
  "coqui-tts==0.24.1" \
  "transformers==4.40.2" \
  "torch<2.6" "torchaudio<2.6" \
  "hangul_romanize"

echo "▶ 임포트 검증..."
COQUI_TOS_AGREED=1 python -c "from TTS.api import TTS; print('OK')"
echo "✅ XTTS 환경 준비 완료. 첫 합성 시 모델(~2GB)이 자동으로 받아집니다."
