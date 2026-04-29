/** Composite screen capture (+ optional webcam PiP) + pointer overlays — canvas.captureStream */

import type { PointerTool } from "./presets";

export type CompositorHandles = {
  outputStream: MediaStream;
  stop: () => void;
};

const PIP_FRACTION = 0.22;

type CursorNorm = {
  nx: number;
  ny: number;
};

export async function startCaptureCompositor({
  screenStream,
  webcamStream,
  micStream,
  frameRate,
  pointerTool,
}: {
  screenStream: MediaStream;
  webcamStream: MediaStream | null;
  micStream: MediaStream | null;
  frameRate: number;
  pointerTool: PointerTool;
}): Promise<CompositorHandles> {
  const screenVid = document.createElement("video");
  screenVid.muted = true;
  screenVid.playsInline = true;

  const screenVt = screenStream.getVideoTracks()[0];
  screenVid.srcObject = new MediaStream([screenVt]);

  let camVid: HTMLVideoElement | null = null;
  const camVt = webcamStream?.getVideoTracks()[0];
  if (camVt) {
    camVid = document.createElement("video");
    camVid.muted = true;
    camVid.playsInline = true;
    camVid.srcObject = new MediaStream([camVt]);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d");

  const cursor: CursorNorm = { nx: 0.5, ny: 0.5 };
  const ripples: { nx: number; ny: number; t0: number }[] = [];

  const onPointerMove = (e: PointerEvent) => {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    cursor.nx = Math.min(1, Math.max(0, e.clientX / vw));
    cursor.ny = Math.min(1, Math.max(0, e.clientY / vh));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pointerTool !== "ripple") return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    ripples.push({
      nx: Math.min(1, Math.max(0, e.clientX / vw)),
      ny: Math.min(1, Math.max(0, e.clientY / vh)),
      t0: performance.now(),
    });
  };

  let running = true;
  let capturer: MediaStream | null = null;
  let rafId = 0;

  if (pointerTool !== "none") {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
  }

  function destroy(): void {
    running = false;
    if (pointerTool !== "none") {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
    }
    cancelAnimationFrame(rafId);
    capturer?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    capturer = null;
    screenVid.pause();
    screenVid.srcObject = null;
    screenVid.remove();
    if (camVid) {
      camVid.pause();
      camVid.srcObject = null;
      camVid.remove();
    }
  }

  const drawLoop = (): void => {
    if (!running) return;
    const w = screenVid.videoWidth;
    const h = screenVid.videoHeight;
    if (w <= 2 || h <= 2) {
      rafId = requestAnimationFrame(drawLoop);
      return;
    }
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(screenVid, 0, 0, w, h);

    if (camVid) {
      const cw = camVid.videoWidth;
      const ch = camVid.videoHeight;
      if (cw > 2 && ch > 2) {
        const pipW = Math.floor(w * PIP_FRACTION);
        const pipH = Math.floor((cw > 0 ? ch / cw : 1) * pipW);
        const ox = Math.max(12, Math.floor(w * (1 - PIP_FRACTION) - 12));
        const oy = Math.max(12, h - pipH - 12);
        const rr = Math.min(16, pipW / 8);

        ctx.save();
        ctx.beginPath();
        roundRect(ctx, ox, oy, pipW, pipH, rr);
        ctx.clip();
        ctx.drawImage(camVid, ox, oy, pipW, pipH);
        ctx.restore();

        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(2, Math.ceil(pipW / 140));
        ctx.beginPath();
        roundRect(ctx, ox, oy, pipW, pipH, rr);
        ctx.stroke();
      }
    }

    const now = performance.now();
    drawPointerOverlays(ctx, w, h, pointerTool, cursor, ripples, now);

    rafId = requestAnimationFrame(drawLoop);
  };

  const playPromises = [screenVid.play().catch(() => undefined)];
  if (camVid) playPromises.push(camVid.play().catch(() => undefined));
  await Promise.all(playPromises);

  drawLoop();
  capturer = canvas.captureStream(frameRate);
  const vTrack = capturer.getVideoTracks()[0];
  const merged = new MediaStream([vTrack]);
  screenStream.getAudioTracks().forEach((t) => merged.addTrack(t));
  micStream?.getAudioTracks().forEach((t) => merged.addTrack(t));

  return {
    outputStream: merged,
    stop: destroy,
  };
}

function drawPointerOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tool: PointerTool,
  cursor: CursorNorm,
  ripples: { nx: number; ny: number; t0: number }[],
  now: number,
): void {
  const px = cursor.nx * w;
  const py = cursor.ny * h;

  if (tool === "laser") {
    const r = Math.max(8, Math.min(w, h) * 0.016);
    ctx.save();
    ctx.shadowBlur = r * 0.85;
    ctx.shadowColor = "rgba(255, 60, 60, 0.75)";
    ctx.fillStyle = "rgba(255, 75, 75, 1)";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (tool === "spotlight") {
    const R = Math.max(w, h) * 0.42;
    const g = ctx.createRadialGradient(px, py, 0, px, py, R);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.35, "rgba(0,0,0,0.12)");
    g.addColorStop(0.65, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (tool === "ripple") {
    const maxAge = 720;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ev = ripples[i]!;
      const age = now - ev.t0;
      if (age > maxAge) {
        ripples.splice(i, 1);
        continue;
      }
      const t = age / maxAge;
      const cx = ev.nx * w;
      const cy = ev.ny * h;
      const rad = 18 + t * Math.max(w, h) * 0.14;
      const alpha = (1 - t) * 0.55;
      ctx.save();
      ctx.strokeStyle = `rgba(124, 108, 245, ${alpha})`;
      ctx.lineWidth = Math.max(2, rad * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
