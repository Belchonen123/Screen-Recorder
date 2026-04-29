export type QualityPreset = "low" | "balanced" | "high";

/** Composited into the canvas capture stream (viewport-relative cursor). */
export type PointerTool = "none" | "laser" | "spotlight" | "ripple";

export type CaptureOptions = {
  quality: QualityPreset;
  /** Overlay webcam Picture-in-Picture on screen via canvas.captureStream */
  webcamPip: boolean;
  /**
   * Draw pointer overlays on captured frames (laser dot, spotlight, or click ripples).
   * Cursor is mapped from this browser tab’s viewport — works best fullscreen or maximized.
   */
  pointerTool?: PointerTool;
  /**
   * Seconds to count down **after** the user picks screen/window/tab in the picker,
   * before encoding starts (0 disables).
   */
  countdownSeconds?: number;
};

export function constraintsForPreset(
  quality: QualityPreset,
): MediaTrackConstraints {
  switch (quality) {
    case "low":
      return {
        frameRate: { max: 15, ideal: 15 },
        width: { max: 1280, ideal: 854 },
        height: { max: 720 },
      };
    case "balanced":
      return {
        frameRate: { max: 24, ideal: 24 },
        width: { max: 1920 },
        height: { max: 1080 },
      };
    case "high":
    default:
      return {
        frameRate: { max: 30, ideal: 30 },
        width: { max: 1920 },
        height: { max: 1080 },
      };
  }
}

export function bitrateHintsForPreset(quality: QualityPreset): {
  videoBitsPerSecond: number | undefined;
  audioBitsPerSecond: number | undefined;
} {
  switch (quality) {
    case "low":
      return { videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 };
    case "balanced":
      return { videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 };
    case "high":
    default:
      return { videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 };
  }
}

export function mimeOrUndefined(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}
