/** Composite screen capture + webcam PIP corner — video from canvas.captureStream */

export type CompositorHandles = {
  outputStream: MediaStream;
  stop: () => void;
};

const PIP_FRACTION = 0.22;

export async function startPIPCompositor({
  screenStream,
  webcamStream,
  micStream,
  frameRate,
}: {
  screenStream: MediaStream;
  webcamStream: MediaStream;
  micStream: MediaStream | null;
  frameRate: number;
}): Promise<CompositorHandles> {
  const screenVid = document.createElement("video");
  const camVid = document.createElement("video");
  screenVid.muted = true;
  camVid.muted = true;
  screenVid.playsInline = true;
  camVid.playsInline = true;

  const screenVt = screenStream.getVideoTracks()[0];
  const camVt = webcamStream.getVideoTracks()[0];

  screenVid.srcObject = new MediaStream([screenVt]);
  camVid.srcObject = new MediaStream([camVt]);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d");

  let running = true;
  let capturer: MediaStream | null = null;
  let rafId = 0;

  function destroy(): void {
    running = false;
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
    camVid.pause();
    screenVid.srcObject = null;
    camVid.srcObject = null;
    screenVid.remove();
    camVid.remove();
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

    rafId = requestAnimationFrame(drawLoop);
  };

  await Promise.all([
    screenVid.play().catch(() => undefined),
    camVid.play().catch(() => undefined),
  ]);

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
