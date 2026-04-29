import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function ensureFfmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton?.loaded) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const v = "0.12.10";
    const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${v}/dist/esm`;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

export async function trimWebBlob(inputBlob: Blob, startSec: number, endSec: number): Promise<Blob> {
  const ffmpeg = await ensureFfmpeg();
  const duration = Math.max(0.1, endSec - startSec);
  await ffmpeg.writeFile("input.webm", await fetchFile(inputBlob));
  const rc = await ffmpeg.exec([
    "-ss",
    startSec.toFixed(3),
    "-i",
    "input.webm",
    "-t",
    duration.toFixed(3),
    "-c",
    "copy",
    "trimmed.webm",
  ]);
  if (rc !== 0) {
    throw new Error(
      "Trim failed (try a shorter range near a keyframe, or reinstall ffmpeg core).",
    );
  }
  const data = (await ffmpeg.readFile("trimmed.webm")) as Uint8Array;
  await ffmpeg.deleteFile("input.webm").catch(() => undefined);
  await ffmpeg.deleteFile("trimmed.webm").catch(() => undefined);
  return new Blob([new Uint8Array(data)], { type: "video/webm" });
}

export async function blobToMp4(inputBlob: Blob): Promise<Blob> {
  const ffmpeg = await ensureFfmpeg();
  await ffmpeg.writeFile("in.webm", await fetchFile(inputBlob));
  const rc = await ffmpeg.exec([
    "-i",
    "in.webm",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "out.mp4",
  ]);
  await ffmpeg.deleteFile("in.webm").catch(() => undefined);
  if (rc !== 0) {
    await ffmpeg.deleteFile("out.mp4").catch(() => undefined);
    throw new Error(
      "Could not encode MP4 — this ffmpeg.wasm build may lack libx264. Use WebM or try Chrome.",
    );
  }
  const data = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
  await ffmpeg.deleteFile("out.mp4").catch(() => undefined);
  return new Blob([new Uint8Array(data)], { type: "video/mp4" });
}
