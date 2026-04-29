import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { blobToMp4, trimWebBlob } from "./ffmpeg/ffmpegClient";

type Props = {
  blob: Blob;
  previewSrc: string;
  posterUrl?: string;
  downloadName: string;
  onDiscard: () => void;
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const frac = Math.round((seconds % 1) * 100);
  const ss =
    frac > 0 ? `${s}.${frac.toString().padStart(2, "0")}` : `${s}`;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${ss.padStart(2, "0")}`;
  }
  return `${m}:${ss.padStart(2, "0")}`;
}

export function PlaybackExports({
  blob,
  previewSrc,
  posterUrl,
  downloadName,
  onDiscard,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  /** Sync trim state when blob / URL changes */
  useEffect(() => {
    setDuration(0);
    setCurrentTime(0);
    setStartSec(0);
    setEndSec(180);
    setErr(null);
  }, [blob, previewSrc]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;

    const syncDuration = (): void => {
      let d = v.duration;
      if ((!Number.isFinite(d) || d <= 0) && v.seekable?.length) {
        try {
          const end = v.seekable.end(v.seekable.length - 1);
          if (Number.isFinite(end) && end > 0) d = end;
        } catch {
          /* ignore */
        }
      }
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
        setEndSec((prev) => Math.min(prev > d ? d : prev, d));
        setStartSec((prev) => Math.min(prev, d));
      }
    };

    const onTime = (): void => setCurrentTime(v.currentTime);

    v.addEventListener("loadedmetadata", syncDuration);
    v.addEventListener("durationchange", syncDuration);
    v.addEventListener("timeupdate", onTime);

    window.setTimeout(() => {
      syncDuration();
      if ((!Number.isFinite(v.duration) || v.duration <= 0) && v.readyState >= 1) {
        void v
          .play()
          .then(() => {
            v.pause();
            v.currentTime = 0;
            syncDuration();
          })
          .catch(() => undefined);
      }
    }, 50);

    return () => {
      v.removeEventListener("loadedmetadata", syncDuration);
      v.removeEventListener("durationchange", syncDuration);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [previewSrc]);

  const sliderMax =
    duration > 0 ? duration : Math.max(endSec, startSec, 300, 60);

  const clientToSec = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el || sliderMax <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      return ratio * sliderMax;
    },
    [sliderMax],
  );

  useEffect(() => {
    if (!dragging) return undefined;

    const move = (e: PointerEvent): void => {
      const t = clientToSec(e.clientX);
      if (dragging === "start") {
        setStartSec(Math.min(Math.max(0, t), endSec - 0.15));
      } else {
        setEndSec(Math.max(Math.min(sliderMax, t), startSec + 0.15));
      }
    };

    const up = (): void => setDragging(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, clientToSec, endSec, startSec, sliderMax]);

  const pct = useMemo(() => {
    const D = sliderMax > 0 ? sliderMax : 1;
    return {
      start: (Math.min(startSec, sliderMax) / D) * 100,
      end: (Math.min(endSec, sliderMax) / D) * 100,
      play: (Math.min(currentTime, sliderMax) / D) * 100,
    };
  }, [startSec, endSec, currentTime, sliderMax]);

  const onTrackPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest(".trim-handle")) return;
      const v = videoRef.current;
      const t = clientToSec(e.clientX);
      if (v && sliderMax > 0) {
        v.currentTime = Math.min(sliderMax, Math.max(0, t));
      }
    },
    [clientToSec, sliderMax],
  );

  const downloadBlob = useCallback((b: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2500);
  }, []);

  const onTrimExport = async () => {
    setBusy("Trimming…");
    setErr(null);
    try {
      const cap = sliderMax > 0 ? sliderMax : 86400;
      const lo = Math.max(0, Math.min(startSec, endSec, cap));
      const hi = Math.max(lo + 0.15, Math.min(cap, Math.max(startSec, endSec)));
      const trimmed = await trimWebBlob(blob, lo, hi);
      downloadBlob(trimmed, `recording-trim-${Date.now()}.webm`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Trim failed");
    } finally {
      setBusy(null);
    }
  };

  const onMp4 = async () => {
    setBusy("Encoding MP4…");
    setErr(null);
    try {
      const mp4 = await blobToMp4(blob);
      downloadBlob(mp4, `recording-${Date.now()}.mp4`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "MP4 failed");
    } finally {
      setBusy(null);
    }
  };

  const metaHint =
    duration > 0 ? (
      <span className="trim-meta-line">
        Keep <strong>{formatClock(startSec)}</strong>
        {" → "}
        <strong>{formatClock(endSec)}</strong>
        {" · "}
        {(endSec - startSec).toFixed(2)}s clip
      </span>
    ) : (
      <span className="trim-meta-line muted small-label">
        Loading timeline length… drag handles once ready.
      </span>
    );

  return (
    <div className="recording-playback">
      <div className="preview-video-wrap">
        <video
          ref={videoRef}
          src={previewSrc}
          poster={posterUrl}
          controls
          playsInline
          className="preview-video"
          preload="metadata"
        />

        <div className="trim-panel">
          <div className="trim-panel-head">
            <span className="trim-panel-title">Trim clip</span>
            {metaHint}
          </div>

          <div
            ref={trackRef}
            className="trim-track"
            onPointerDown={onTrackPointerDown}
          >
            <div
              className="trim-track__shade trim-track__shade--left"
              style={{ width: `${pct.start}%` }}
            />
            <div
              className="trim-track__shade trim-track__shade--right"
              style={{ width: `${100 - pct.end}%` }}
            />
            <div
              className="trim-track__keep"
              style={{
                left: `${pct.start}%`,
                width: `${pct.end - pct.start}%`,
              }}
            />
            <div
              className="trim-playhead"
              style={{ left: `${pct.play}%` }}
              aria-hidden
            />
            <button
              type="button"
              className="trim-handle trim-handle--start"
              style={{ left: `${pct.start}%` }}
              aria-label="Trim start handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDragging("start");
              }}
            />
            <button
              type="button"
              className="trim-handle trim-handle--end"
              style={{ left: `${pct.end}%` }}
              aria-label="Trim end handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDragging("end");
              }}
            />
          </div>

          <p className="muted tiny trim-help">
            Purple band is what you keep. Drag handles — click the bar to seek.
          </p>
        </div>

        <p className="muted tiny preview-audio-hint">
          <strong>Speaker crossed out?</strong> Click it on the player to hear audio.
        </p>
      </div>

      <div className="actions">
        <a href={previewSrc} download={downloadName} className="btn primary">
          Download WebM
        </a>
        <button type="button" className="btn ghost" onClick={onDiscard}>
          Discard
        </button>
      </div>

      <div className="playback-actions playback-actions--below">
        <button
          type="button"
          className="btn secondary small"
          disabled={!!busy}
          onClick={() => void onTrimExport()}
        >
          {busy === "Trimming…" ? busy : "Export trimmed WebM"}
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={!!busy}
          onClick={() => void onMp4()}
        >
          {busy === "Encoding MP4…" ? busy : "Export MP4"}
        </button>
      </div>

      {busy && busy !== "Trimming…" && busy !== "Encoding MP4…" ? (
        <p className="muted">{busy}</p>
      ) : null}
      {err ? <p className="error-msg">{err}</p> : null}
    </div>
  );
}
