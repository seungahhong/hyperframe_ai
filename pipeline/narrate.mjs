// 3단계: 내레이션 — 각 자막 line을 TTS로 합성하고, 정확한 길이를 측정해
// 하나의 narration.wav 로 합치며, 씬/라인 타이밍(transcript.json)을 만든다.
//
// 핵심 아이디어: "자막 line 단위로 합성 → ffprobe로 길이 측정"하면
// Whisper 추정 없이도 오디오와 모션그래픽의 싱크가 정확히 맞는다.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synthLine } from "../lib/tts.mjs";
import { capture, mediaDuration, round2 } from "../lib/util.mjs";

const LEAD = 0.3; // 시작 무음
const LINE_GAP = 0.18; // 같은 씬 내 라인 사이
const SCENE_GAP = 0.45; // 씬 경계
const TAIL = 0.6; // 마지막 여운
const VISUAL_LEAD = 0.15; // 다음 씬 비주얼이 내레이션보다 약간 먼저 등장

async function makeSilence(seconds, outWav) {
  await capture("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    String(seconds),
    outWav,
  ]);
}

/**
 * @param script  summarize 결과
 * @param projDir 프로젝트 폴더 (audio/ 하위에 결과 저장)
 * @returns { script(타이밍 보강), transcript }
 */
export async function narrate({ script, projDir }) {
  const audioDir = join(projDir, "audio");
  const partsDir = join(audioDir, "parts");
  await rm(partsDir, { recursive: true, force: true });
  await mkdir(partsDir, { recursive: true });

  const lang = script.meta.lang || "ko";
  const voice = script.meta.voice;

  const concatItems = []; // ffmpeg concat 순서
  const lineTimings = []; // {sceneId, text, start, end}
  let t = LEAD;

  // 시작 무음
  const leadSil = join(partsDir, "lead.wav");
  await makeSilence(LEAD, leadSil);
  concatItems.push(leadSil);

  const sceneFirstStart = {};

  for (let si = 0; si < script.scenes.length; si++) {
    const scene = script.scenes[si];
    const lines = scene.lines.length ? scene.lines : [scene.heading].filter(Boolean);
    for (let li = 0; li < lines.length; li++) {
      const text = lines[li];
      const wav = join(partsDir, `s${si}-l${li}.wav`);
      const dur = await synthLine({ text, lang, voice, outWav: wav });
      const start = round2(t);
      const end = round2(t + dur);
      if (sceneFirstStart[scene.id] === undefined) sceneFirstStart[scene.id] = start;
      lineTimings.push({ sceneId: scene.id, text, start, end });
      concatItems.push(wav);
      t = end;

      const lastOverall = si === script.scenes.length - 1 && li === lines.length - 1;
      const lastInScene = li === lines.length - 1;
      const gap = lastOverall ? TAIL : lastInScene ? SCENE_GAP : LINE_GAP;
      const sil = join(partsDir, `s${si}-l${li}-gap.wav`);
      await makeSilence(gap, sil);
      concatItems.push(sil);
      t = round2(t + gap);
    }
  }
  const total = round2(t);

  // narration.wav 로 합치기 (concat demuxer)
  const listFile = join(partsDir, "concat.txt");
  await writeFile(
    listFile,
    concatItems.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const narrationWav = join(audioDir, "narration.wav");
  // 파트별 코덱/샘플포맷 차이를 피하려고 concat 시 재인코딩한다.
  await capture("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    narrationWav,
  ]);
  const measuredTotal = round2(await mediaDuration(narrationWav));

  // 씬 타일링: 각 씬 비주얼이 다음 씬 직전까지 유지되도록 경계를 잡는다.
  const scenes = script.scenes;
  for (let i = 0; i < scenes.length; i++) {
    scenes[i].start = i === 0 ? 0 : undefined;
  }
  for (let i = 1; i < scenes.length; i++) {
    const fs = sceneFirstStart[scenes[i].id] ?? lineTimings.find((l) => l.sceneId === scenes[i].id)?.start ?? 0;
    const b = round2(Math.max(fs - VISUAL_LEAD, scenes[i - 1].start + 0.5));
    scenes[i - 1].end = b;
    scenes[i].start = b;
  }
  scenes[scenes.length - 1].end = measuredTotal;
  for (const s of scenes) s.duration = round2(s.end - s.start);

  const transcript = {
    total: measuredTotal,
    audio: "audio/narration.wav",
    lines: lineTimings,
    scenes: scenes.map((s) => ({ id: s.id, start: s.start, duration: s.duration })),
  };

  // parts 정리(원하면 보존 가능)
  await rm(partsDir, { recursive: true, force: true });

  return { script, transcript, narrationWav, total: measuredTotal };
}
