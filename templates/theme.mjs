// 공통 디자인 토큰 — 모든 프로젝트가 공유하는 톤/색/폰트.
// 참고 영상의 "templates 폴더에 색상·톤·폰트 같은 공통 요소를 둔다" 원칙을 코드로 옮긴 것.

export const THEME = {
  // 색
  bg: "#0B1020", // 딥 네이비 배경
  bgAlt: "#11183058",
  ink: "#F4F6FB", // 본문 텍스트(밝음)
  inkDim: "#9AA7C7", // 보조 텍스트
  accent: "#5B8CFF", // 포인트(블루)
  accent2: "#7CF5C4", // 포인트2(민트)
  accent3: "#FFB86B", // 포인트3(앰버)
  grid: "#1B254640",

  // 폰트 — 한글 가독성이 좋은 시스템 폰트 스택
  fontSans:
    "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontMono:
    "'SF Mono', 'JetBrains Mono', 'D2Coding', ui-monospace, Menlo, monospace",

  // 캔버스
  width: 1920,
  height: 1080,
  fps: 30,

  // 자막 박스
  captionBottom: 96,
  captionFontSize: 52,
};

// 시각 연출 타입별 강조색을 순환시켜서 단조로움을 피한다.
export const ACCENT_CYCLE = [THEME.accent, THEME.accent2, THEME.accent3];

export function accentFor(i) {
  return ACCENT_CYCLE[i % ACCENT_CYCLE.length];
}
