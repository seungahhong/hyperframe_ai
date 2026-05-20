// 5단계: 렌더 — HyperFrames로 컴포지션을 MP4로 굽는다.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../lib/util.mjs";

export async function render({ projDir, output = "out/video.mp4", fps = 30, quality = "standard", extra = [] }) {
  await mkdir(join(projDir, "out"), { recursive: true });
  const args = ["-y", "hyperframes@0.6.29", "render", "-f", String(fps), "-q", quality, "-o", output, ...extra];
  await run("npx", args, { cwd: projDir });
  return join(projDir, output);
}

export async function lint({ projDir }) {
  try {
    await run("npx", ["-y", "hyperframes@0.6.29", "lint"], { cwd: projDir });
    return true;
  } catch {
    return false;
  }
}

export async function snapshot({ projDir, outDir = "out/frames" }) {
  // 자가 검증용 키프레임 PNG 추출(참고 영상의 "레이아웃 스냅샷 게이트").
  try {
    await run("npx", ["-y", "hyperframes@0.6.29", "snapshot", "-o", outDir], { cwd: projDir });
    return join(projDir, outDir);
  } catch {
    return null;
  }
}
