import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureOptions } from "./recording/presets";
import {
  bitrateHintsForPreset,
  constraintsForPreset,
  mimeOrUndefined,
} from "./recording/presets";
import { startPIPCompositor } from "./recording/compositor";

export type RecorderState =
  | { status: "idle" }
  | { status: "countdown"; remaining: number }
  | {
      status: "recording";
      seconds: number;
      paused: boolean;
      pauseSupported: boolean;
      screenAudioOn: boolean;
      micOn: boolean;
    }
  | { status: "stopped"; blob: Blob; mimeType: string; previewUrl: string }
  | { status: "error"; message: string };

const defaultCaptureOptions: CaptureOptions = {
  quality: "balanced",
  webcamPip: false,
  countdownSeconds: 0,
};

function combineStreams(
  display: MediaStream,
  micStream: MediaStream | null,
): MediaStream {
  const out = new MediaStream();
  display.getVideoTracks().forEach((t) => out.addTrack(t));
  display.getAudioTracks().forEach((t) => out.addTrack(t));
  micStream?.getAudioTracks().forEach((t) => out.addTrack(t));
  return out;
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
}

export function recordingEnvironmentHint(): string | null {
  return environmentBlocker();
}

export function supportsMediaRecorderPause(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.prototype.pause === "function"
  );
}

function environmentBlocker(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) {
    return "Screen recording needs a secure context. Use https:// or open the app on http://localhost (not a file:// URL).";
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return "This environment does not support screen capture (common in an editor’s built-in browser). Open http://localhost:5173/ in Chrome or Edge in a normal window.";
  }
  if (typeof MediaRecorder === "undefined") {
    return "This browser does not support MediaRecorder.";
  }
  return null;
}

function mapCaptureError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") {
      return "Screen capture was canceled or denied.";
    }
    if (e.name === "NotSupportedError" || e.name === "NotFoundError") {
      return "Screen capture is not supported here. Open the app in Chrome or Edge (full browser window), not the editor’s preview panel.";
    }
  }
  if (e instanceof Error && e.message) {
    if (e.message.toLowerCase().includes("not supported")) {
      return "Screen capture is not supported in this embedded browser. Open http://localhost:5173/ in Chrome or Edge.";
    }
    return e.message;
  }
  return "Could not start screen capture.";
}

export function useScreenRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const compositorStopRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const secondsRef = useRef(0);
  const pausedRef = useRef(false);
  const mimeTypeRef = useRef<string>("video/webm");
  const previewUrlRef = useRef<string | null>(null);
  const pendingRecordStreamRef = useRef<MediaStream | null>(null);
  const pendingRecorderOptionsRef = useRef<MediaRecorderOptions>({});

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const clearTicker = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const stopInputStreamsOnly = useCallback(() => {
    compositorStopRef.current?.();
    compositorStopRef.current = null;
    stopTracks(webcamStreamRef.current);
    webcamStreamRef.current = null;
    stopTracks(displayStreamRef.current);
    stopTracks(micStreamRef.current);
    displayStreamRef.current = null;
    micStreamRef.current = null;
  }, []);

  const finalizeChunks = useCallback(() => {
    const mimeActual = recorderRef.current?.mimeType || mimeTypeRef.current;
    recorderRef.current = null;
    const parts = chunksRef.current.slice();
    chunksRef.current = [];
    mimeTypeRef.current = mimeActual;
    stopInputStreamsOnly();
    clearTicker();
    pausedRef.current = false;

    const blob = new Blob(parts, { type: mimeActual });
    revokePreviewUrl();
    secondsRef.current = 0;

    if (blob.size === 0) {
      setState({
        status: "error",
        message:
          "Nothing was captured. Grant screen capture and choose a tab, window, or screen with Share audio checked if you need system/tab sound.",
      });
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    previewUrlRef.current = previewUrl;

    setState({
      status: "stopped",
      blob,
      mimeType: mimeActual,
      previewUrl,
    });
  }, [clearTicker, revokePreviewUrl, stopInputStreamsOnly]);

  useEffect(() => {
    return () => {
      clearTicker();
      stopInputStreamsOnly();
      revokePreviewUrl();
      recorderRef.current = null;
    };
  }, [clearTicker, revokePreviewUrl, stopInputStreamsOnly]);

  const bumpRecordingState = useCallback(() => {
    setState({
      status: "recording",
      seconds: secondsRef.current,
      paused: pausedRef.current,
      pauseSupported: supportsMediaRecorderPause(),
      screenAudioOn: tracksAnyEnabled(
        displayStreamRef.current?.getAudioTracks() ?? [],
      ),
      micOn:
        micStreamRef.current?.getAudioTracks().some((t) => t.enabled) ?? false,
    });
  }, []);

  const beginTicker = useCallback(() => {
    clearTicker();
    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      secondsRef.current += 1;
      bumpRecordingState();
    }, 1000);
  }, [bumpRecordingState, clearTicker]);

  const beginRecordingAfterCapture = useCallback(() => {
    const recordStream = pendingRecordStreamRef.current;
    if (!recordStream) return;
    pendingRecordStreamRef.current = null;

    const options = { ...pendingRecorderOptionsRef.current };
    pendingRecorderOptionsRef.current = {};

    const displayStream = displayStreamRef.current;
    const micStream = micStreamRef.current;
    if (!displayStream) {
      stopInputStreamsOnly();
      setState({
        status: "error",
        message: "Capture stream was lost before recording started.",
      });
      return;
    }

    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(recordStream, options);
    } catch {
      try {
        const mt = mimeOrUndefined();
        mediaRecorder =
          mt !== undefined
            ? new MediaRecorder(recordStream, { mimeType: mt })
            : new MediaRecorder(recordStream);
      } catch {
        mediaRecorder = new MediaRecorder(recordStream);
      }
    }

    recorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onerror = () => {
      setState({
        status: "error",
        message:
          "Recording failed in the browser. Try another screen or reload the tab.",
      });
    };

    const videoTrack = displayStream.getVideoTracks()[0];
    videoTrack?.addEventListener(
      "ended",
      () => {
        mediaRecorder.stop();
      },
      { once: true },
    );

    mediaRecorder.onstop = () => {
      finalizeChunks();
    };

    mediaRecorder.start(250);
    beginTicker();

    setState({
      status: "recording",
      seconds: 0,
      paused: false,
      pauseSupported: supportsMediaRecorderPause(),
      screenAudioOn: tracksAnyEnabled(displayStream.getAudioTracks()),
      micOn: micStream?.getAudioTracks().some((t) => t.enabled) ?? false,
    });
  }, [beginTicker, finalizeChunks, stopInputStreamsOnly]);

  useEffect(() => {
    if (state.status !== "countdown") return undefined;
    const r = state.remaining;
    if (r <= 0) {
      beginRecordingAfterCapture();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setState((prev) =>
        prev.status === "countdown" && prev.remaining > 0
          ? { status: "countdown", remaining: prev.remaining - 1 }
          : prev,
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [state, beginRecordingAfterCapture]);

  const start = useCallback(
    async (opts?: Partial<CaptureOptions>) => {
      const merged: CaptureOptions = { ...defaultCaptureOptions, ...opts };

      revokePreviewUrl();
      clearTicker();
      chunksRef.current = [];
      secondsRef.current = 0;
      pausedRef.current = false;

      const blocked = environmentBlocker();
      if (blocked) {
        setState({ status: "error", message: blocked });
        return;
      }

      try {
        const constraints = constraintsForPreset(merged.quality);

        let displayStream: MediaStream;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { ...constraints },
            audio: true,
          });
        } catch (first) {
          if (
            first instanceof DOMException &&
            first.name === "NotSupportedError"
          ) {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
              video: { ...constraints },
              audio: false,
            });
          } else {
            throw first;
          }
        }
        displayStreamRef.current = displayStream;

        let micStream: MediaStream | null = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              channelCount: 1,
            },
            video: false,
          });
        } catch {
          micStream = null;
        }
        micStreamRef.current = micStream;

        let webcamStream: MediaStream | null = null;
        if (merged.webcamPip) {
          try {
            webcamStream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: "user",
                width: { ideal: 960 },
              },
              audio: false,
            });
          } catch {
            webcamStream = null;
          }
          webcamStreamRef.current = webcamStream;
        }

        const cr = constraints.frameRate;
        let fps = 30;
        if (cr && typeof cr === "object") {
          if ("ideal" in cr && typeof cr.ideal === "number") fps = cr.ideal;
          else if ("max" in cr && typeof cr.max === "number") fps = cr.max;
        }

        let recordStream: MediaStream;
        if (
          merged.webcamPip &&
          webcamStream &&
          webcamStream.getVideoTracks()[0]
        ) {
          const comp = await startPIPCompositor({
            screenStream: displayStream,
            webcamStream,
            micStream,
            frameRate: Math.min(30, Math.max(8, fps)),
          });
          compositorStopRef.current = comp.stop;
          recordStream = comp.outputStream;
        } else {
          if (webcamStream) {
            stopTracks(webcamStream);
            webcamStreamRef.current = null;
          }
          recordStream = combineStreams(displayStream, micStream);
        }

        const mimeType = mimeOrUndefined();
        mimeTypeRef.current = mimeType ?? "video/webm";
        const bitrates = bitrateHintsForPreset(merged.quality);

        const recorderOptions: MediaRecorderOptions = {};
        if (mimeType) recorderOptions.mimeType = mimeType;
        if (typeof bitrates.videoBitsPerSecond === "number") {
          recorderOptions.videoBitsPerSecond = bitrates.videoBitsPerSecond;
        }
        if (typeof bitrates.audioBitsPerSecond === "number") {
          recorderOptions.audioBitsPerSecond = bitrates.audioBitsPerSecond;
        }

        pendingRecordStreamRef.current = recordStream;
        pendingRecorderOptionsRef.current = recorderOptions;

        const countdown = merged.countdownSeconds ?? 0;
        if (countdown > 0) {
          setState({ status: "countdown", remaining: countdown });
          return;
        }

        beginRecordingAfterCapture();
      } catch (e) {
        stopInputStreamsOnly();
        setState({ status: "error", message: mapCaptureError(e) });
      }
    },
    [
      beginRecordingAfterCapture,
      beginTicker,
      clearTicker,
      finalizeChunks,
      revokePreviewUrl,
      stopInputStreamsOnly,
    ],
  );

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    try {
      r.pause();
      pausedRef.current = true;
      bumpRecordingState();
    } catch {
      /* ignore */
    }
  }, [bumpRecordingState]);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "paused") return;
    try {
      r.resume();
      pausedRef.current = false;
      bumpRecordingState();
    } catch {
      /* ignore */
    }
  }, [bumpRecordingState]);

  const toggleScreenAudio = useCallback(() => {
    const d = displayStreamRef.current;
    if (!d) return;
    const tracks = d.getAudioTracks();
    if (tracks.length === 0) return;
    const enable = tracks.some((t) => !t.enabled);
    tracks.forEach((t) => {
      t.enabled = enable;
    });
    bumpRecordingState();
  }, [bumpRecordingState]);

  const toggleMic = useCallback(() => {
    const m = micStreamRef.current;
    if (!m) return;
    const tracks = m.getAudioTracks();
    if (tracks.length === 0) return;
    const enable = tracks.some((t) => !t.enabled);
    tracks.forEach((t) => {
      t.enabled = enable;
    });
    bumpRecordingState();
  }, [bumpRecordingState]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try {
      r.stop();
    } catch {
      finalizeChunks();
    }
  }, [finalizeChunks]);

  const discard = useCallback(() => {
    clearTicker();
    pendingRecordStreamRef.current = null;
    pendingRecorderOptionsRef.current = {};
    stopInputStreamsOnly();
    recorderRef.current = null;
    chunksRef.current = [];
    secondsRef.current = 0;
    pausedRef.current = false;
    revokePreviewUrl();
    setState({ status: "idle" });
  }, [clearTicker, revokePreviewUrl, stopInputStreamsOnly]);

  return {
    state,
    start,
    stop,
    discard,
    pause,
    resume,
    toggleMic,
    toggleScreenAudio,
  };
}

function tracksAnyEnabled(tracks: MediaStreamTrack[]): boolean {
  if (tracks.length === 0) return false;
  return tracks.some((t) => t.enabled);
}
