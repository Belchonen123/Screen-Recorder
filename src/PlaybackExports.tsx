import { useCallback, useEffect, useState } from "react";
import { blobToMp4, trimWebBlob } from "./ffmpeg/ffmpegClient";

type Props = {
  blob: Blob;
  mimeType?: string;
};

export function PlaybackExports({ blob }: Props) {
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    const onMeta = (): void => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      setDuration(d);
      setStartSec(0);
      setEndSec(d || 1);
    };
    const onErr = (): void => {
      setDuration(10);
      setStartSec(0);
      setEndSec(10);
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onErr);
    return () => {
      v.removeAttribute("src");
      v.load();
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onErr);
      URL.revokeObjectURL(url);
    };
  }, [blob]);

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
      const lo = Math.max(0, Math.min(startSec, endSec, duration || 99999));
      const hi = Math.max(lo + 0.15, Math.min(duration || lo + 1, Math.max(startSec, endSec)));
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

  return (
    <div className="playback-exports card">
      <h3>Edit &amp; export</h3>
      <p className="muted tiny">
        Trimming copies stream segments when possible. MP4 needs H.264 in this ffmpeg wasm
        bundle—WebM downloads always work in Chromium.
      </p>

      {duration > 0 && (
        <div className="trim-range">
          <label className="field">
            <span>Trim start ({startSec.toFixed(2)} s)</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={startSec}
              onChange={(e) => setStartSec(Number.parseFloat(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Trim end ({endSec.toFixed(2)} s)</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={endSec}
              onChange={(e) => setEndSec(Number.parseFloat(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="playback-actions">
        <button type="button" className="btn secondary small" disabled={!!busy} onClick={() => void onTrimExport()}>
          {busy === "Trimming…" ? busy : "Export trimmed WebM"}
        </button>
        <button type="button" className="btn ghost small" disabled={!!busy} onClick={() => void onMp4()}>
          {busy === "Encoding MP4…" ? busy : "Export MP4"}
        </button>
      </div>

      {busy && busy !== "Trimming…" && busy !== "Encoding MP4…" ? <p className="muted">{busy}</p> : null}
      {err ? <p className="error-msg">{err}</p> : null}
    </div>
  );
}
