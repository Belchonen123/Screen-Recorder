/**
 * Extract first video frame from a Blob as JPEG for Convex thumbnail upload / preview.
 */
export async function videoBlobToPosterJpeg(blob: Blob, scaleMax = 480): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = (): void => resolve();
      video.onerror = (): void =>
        reject(new Error("Could not load video for thumbnail."));
      video.src = url;
    });

    const seekTo =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.1, Math.max(video.duration * 0.001, 0.001))
        : 0.001;

    await new Promise<void>((resolve, reject) => {
      const onSeeked = (): void => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onErr);
        resolve();
      };
      const onErr = (): void => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onErr);
        reject(new Error("seek failed"));
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onErr);
      video.currentTime = seekTo;
    }).catch(async () => {
      video.currentTime = 0;
      await video.play().catch(() => undefined);
      video.pause();
    });

    let w = video.videoWidth || 640;
    let h = video.videoHeight || 360;
    if (Math.max(w, h) > scaleMax) {
      const r = scaleMax / Math.max(w, h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext("2d");
    if (!cx) throw new Error("canvas 2d");
    cx.drawImage(video, 0, 0, w, h);

    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.82,
      );
    });

    video.src = "";
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
