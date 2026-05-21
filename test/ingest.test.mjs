// 인제스트 쿠키 인자 선택 로직 테스트.
// 익명으로 자막이 없을 때 쿠키(파일/브라우저)로 yt-dlp에 인증해 실시간/자동 자막에 접근한다.
// 실행: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ytCookieArgs } from "../pipeline/ingest.mjs";

// 환경변수 격리: 각 케이스 전후로 원복.
function withEnv(env, fn) {
  const keys = ["HF_YT_COOKIES", "HF_YT_COOKIES_FROM_BROWSER"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("쿠키 미설정이면 빈 인자(익명)", () => {
  withEnv({}, () => {
    assert.deepEqual(ytCookieArgs(), []);
    assert.deepEqual(ytCookieArgs({}), []);
  });
});

test("--cookies 파일 옵션 → --cookies 인자", () => {
  withEnv({}, () => {
    assert.deepEqual(ytCookieArgs({ cookies: "c.txt" }), ["--cookies", "c.txt"]);
  });
});

test("--cookies-from-browser 옵션 → 브라우저 추출 인자", () => {
  withEnv({}, () => {
    assert.deepEqual(ytCookieArgs({ cookiesFromBrowser: "chrome" }), [
      "--cookies-from-browser",
      "chrome",
    ]);
  });
});

test("파일이 브라우저보다 우선", () => {
  withEnv({}, () => {
    assert.deepEqual(ytCookieArgs({ cookies: "c.txt", cookiesFromBrowser: "chrome" }), [
      "--cookies",
      "c.txt",
    ]);
  });
});

test("옵션이 없으면 환경변수로 폴백", () => {
  withEnv({ HF_YT_COOKIES: "env.txt" }, () => {
    assert.deepEqual(ytCookieArgs(), ["--cookies", "env.txt"]);
  });
  withEnv({ HF_YT_COOKIES_FROM_BROWSER: "safari" }, () => {
    assert.deepEqual(ytCookieArgs(), ["--cookies-from-browser", "safari"]);
  });
});

test("명시 옵션이 환경변수보다 우선", () => {
  withEnv({ HF_YT_COOKIES_FROM_BROWSER: "safari" }, () => {
    assert.deepEqual(ytCookieArgs({ cookiesFromBrowser: "chrome" }), [
      "--cookies-from-browser",
      "chrome",
    ]);
  });
});
