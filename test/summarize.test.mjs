// 요약 단계 불변식 테스트: 말줄임표(…) 없음 / 화면 항목은 짧게 / 자막은 잘리지 않고 분할.
// 실행: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyphrase, splitCaption, summarize } from "../pipeline/summarize.mjs";

const LONG =
  "지금까지 출시된 모델 중 가장 강력한 에이전트 및 코딩 모델로, 초당 출력 토큰 수 기준으로 다른 프런티어 모델 대비 네 배 빠른 속도를 자랑합니다";

test("keyphrase: 말줄임표 없이 max 이내로", () => {
  const k = keyphrase(LONG, 18);
  assert.ok(!k.includes("…"), "… 포함되면 안 됨");
  assert.ok(!k.includes("..."), "... 포함되면 안 됨");
  assert.ok(k.length <= 18, `길이 ${k.length} ≤ 18`);
  assert.ok(k.length > 0);
});

test("splitCaption: 잘라내지 않고(글자 손실 없이) 청크로 분할", () => {
  const parts = splitCaption(LONG, 34);
  assert.ok(parts.length >= 2, "긴 문장은 2개 이상으로 분할");
  for (const p of parts) {
    assert.ok(!p.includes("…"), "… 없음");
    assert.ok(p.length <= 34 + 2, `청크 길이 ${p.length} ≲ 34`);
  }
  // 글자 손실이 없어야 한다(공백/쉼표 제외하고 원문 글자가 모두 보존).
  const norm = (s) => s.replace(/[\s,，]/g, "");
  assert.equal(norm(parts.join("")), norm(LONG), "분할 후 글자 손실 없음");
});

test("summarize 폴백: 화면 항목 짧고, 자막은 더 많고, 어디에도 … 없음", async () => {
  const text = Array.from({ length: 12 }, (_, i) =>
    `${i + 1}번 항목으로 구글은 제미나이 3.5를 통해 에이전트와 코딩 성능을 크게 끌어올렸고, 비용은 절반 이하로 낮췄습니다.`,
  ).join(" ");
  const script = await summarize({ text, title: "제미나이 3.5 발표 요약 매우 긴 제목 테스트", lang: "ko" });

  assert.ok(script.scenes.length >= 3, "씬 3개 이상");
  let itemCount = 0;
  let lineCount = 0;
  for (const sc of script.scenes) {
    const items = sc.data?.items || [];
    for (const it of items) {
      itemCount++;
      assert.ok(!String(it).includes("…") && !String(it).includes("..."), `항목에 말줄임표: ${it}`);
      assert.ok(String(it).length <= 20, `항목이 너무 김(${String(it).length}): ${it}`);
    }
    for (const ln of sc.lines || []) {
      lineCount++;
      assert.ok(!String(ln).includes("…") && !String(ln).includes("..."), `자막에 말줄임표: ${ln}`);
    }
  }
  // 자막/보이스(lines)가 화면 항목(items)보다 더 많은 정보를 담아야 한다.
  assert.ok(lineCount >= itemCount, `자막 ${lineCount} ≥ 항목 ${itemCount}`);
});
