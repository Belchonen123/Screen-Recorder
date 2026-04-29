import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import type { GenericId } from "convex/values";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaybackExports } from "./PlaybackExports";
import type { PointerTool, QualityPreset } from "./recording/presets";
import {
  recordingEnvironmentHint,
  useScreenRecorder,
} from "./useScreenRecorder";
import { anyApi } from "convex/server";
import { videoBlobToPosterJpeg } from "./thumbnail";

/** Matches `list` validator in convex/recordings.ts */
type ConvexRecordingDoc = {
  _id: GenericId<"recordings">;
  _creationTime: number;
  storageId: GenericId<"_storage">;
  thumbnailStorageId?: GenericId<"_storage">;
  title: string;
  byteSize?: number;
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const url = import.meta.env.VITE_CONVEX_URL?.trim();
  if (!url) return <StandaloneShell />;
  return (
    <ConvexProvider client={new ConvexReactClient(url)}>
      <StandaloneShell convex />
    </ConvexProvider>
  );
}

function StandaloneShell({ convex = false }: { convex?: boolean }) {
  return (
    <>
      <header className="top">
        <h1 className="brand">Screen capture</h1>
        <p className="subtitle">
          Choose what to share (screen, window, or tab) first; optional countdown runs after that, then
          encoding. Pointer tools (laser, spotlight, click ripples), webcam PiP, pause, trim / MP4 export.
        </p>
      </header>

      <main className="main">
        <RecorderPanel convex={convex} />
        {convex ? <ConvexLibrary /> : null}
      </main>
    </>
  );
}

function RecorderPanel({ convex }: { convex: boolean }) {
  const {
    state,
    webcamBubbleStream,
    compositeLivePreview,
    start,
    stop,
    discard,
    pause,
    resume,
    toggleMic,
    toggleScreenAudio,
  } = useScreenRecorder();
  const [quality, setQuality] = useState<QualityPreset>("balanced");
  const [countdownSec, setCountdownSec] = useState(0);
  const [webcamPip, setWebcamPip] = useState(false);
  const [pointerTool, setPointerTool] = useState<PointerTool>("none");

  const envHint = useMemo(() => recordingEnvironmentHint(), []);

  const downloadHref = state.status === "stopped" ? state.previewUrl : undefined;
  const downloadName =
    state.status === "stopped" ? `recording-${Date.now()}.webm` : "recording.webm";

  let statusBadge = "";
  if (state.status === "idle") statusBadge = "Ready";
  else if (state.status === "countdown")
    statusBadge = `Starts in ${state.remaining}s (capture already selected)`;
  else if (state.status === "recording") {
    const z = state.paused ? " — paused" : "";
    statusBadge = `Recording ${formatTime(state.seconds)}${z}`;
  } else if (state.status === "stopped") statusBadge = "Recorded";
  else statusBadge = "Error";
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  useEffect(() => {
    if (state.status !== "stopped") {
      setPosterUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const jpeg = await videoBlobToPosterJpeg(state.blob);
        if (cancelled) return;
        const u = URL.createObjectURL(jpeg);
        setPosterUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return u;
        });
      } catch {
        setPosterUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const capturing =
    state.status === "countdown" || state.status === "recording";
  /** PiP webcam in composite preview — hide raw webcam bubble when compositor feeds live preview */
  const bubbleVisible =
    Boolean(webcamBubbleStream) &&
    capturing &&
    compositeLivePreview == null;

  return (
    <>
      <CompositeEncodePreview stream={compositeLivePreview} active={capturing} />
      <WebcamBubbleOverlay stream={bubbleVisible ? webcamBubbleStream : null} />
      <section className="card recorder-card" aria-labelledby="rec-title">
      <h2 id="rec-title">Capture</h2>

      {envHint ? (
        <p className="env-warn" role="status">
          {envHint}
        </p>
      ) : null}

      {state.status === "idle" || state.status === "error" ? (
        <div className="capture-options">
          <label className="field inline">
            <span>Quality</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityPreset)}
            >
              <option value="low">Low (smaller file)</option>
              <option value="balanced">Balanced</option>
              <option value="high">High clarity</option>
            </select>
          </label>
          <label className="field inline">
            <span>Countdown</span>
            <select
              value={countdownSec}
              onChange={(e) => setCountdownSec(Number.parseInt(e.target.value, 10))}
            >
              <option value={0}>None (start immediately)</option>
              <option value={3}>3 seconds after picker</option>
              <option value={5}>5 seconds after picker</option>
            </select>
          </label>
          <label className="field inline">
            <span>Pointer tools</span>
            <select
              value={pointerTool}
              onChange={(e) => setPointerTool(e.target.value as PointerTool)}
            >
              <option value="none">Off</option>
              <option value="laser">Laser</option>
              <option value="spotlight">Spotlight</option>
              <option value="ripple">Click ripples</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={webcamPip}
              onChange={(e) => setWebcamPip(e.target.checked)}
            />
            Webcam bubble (PiP)
          </label>
        </div>
      ) : null}

      {state.status === "countdown" && state.remaining > 0 ? (
        <div className="countdown-overlay" aria-live="assertive">
          <span className="countdown-num">{state.remaining}</span>
        </div>
      ) : null}

      <p className="status-line" aria-live="polite">
        {statusBadge}
      </p>

      {state.status === "recording" && (
        <div className="track-pills" aria-label="Audio sources">
          <button
            type="button"
            className={`pill ${state.micOn ? "on" : "muted"}`}
            onClick={toggleMic}
          >
            Mic: {state.micOn ? "on" : "muted"}
          </button>
          <button
            type="button"
            className={`pill ${state.screenAudioOn ? "on" : "muted"}`}
            onClick={toggleScreenAudio}
          >
            Screen / tab audio: {state.screenAudioOn ? "on" : "muted"}
          </button>
        </div>
      )}

      {state.status === "error" && (
        <p className="error-msg" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "idle" || state.status === "error" ? (
        <button type="button" className="btn primary" onClick={() => void start({ quality, webcamPip, countdownSeconds: countdownSec, pointerTool })}>
          Start recording
        </button>
      ) : null}

      {state.status === "countdown" ? (
        <button type="button" className="btn ghost" onClick={discard}>
          Cancel countdown
        </button>
      ) : null}

      {state.status === "recording" ? (
        <div className="rec-actions">
          {state.pauseSupported &&
            (state.paused ? (
              <button type="button" className="btn secondary" onClick={resume}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn secondary" onClick={pause}>
                Pause
              </button>
            ))}
          {!state.pauseSupported ? (
            <span className="muted tiny">Pause not supported.</span>
          ) : null}
          <button type="button" className="btn danger" onClick={stop}>
            Stop
          </button>
        </div>
      ) : null}

      {state.status === "stopped" && downloadHref ? (
        <PlaybackExports
          blob={state.blob}
          previewSrc={downloadHref}
          posterUrl={posterUrl ?? undefined}
          downloadName={downloadName}
          onDiscard={discard}
        />
      ) : null}

      {state.status === "stopped" && convex ? (
        <ConvexUploadEmbedded
          blob={state.blob}
          titlePlaceholder={downloadName.replace(/\.webm$/i, "")}
        />
      ) : null}
    </section>
    </>
  );
}

/** Live-encoded compositor preview — same pixels as recording (muted for autoplay) */
function CompositeEncodePreview({
  stream,
  active,
}: {
  stream: MediaStream | null;
  active: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream || !active) {
      if (el) el.srcObject = null;
      return undefined;
    }
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [stream, active]);

  if (!stream || !active) return null;

  return (
    <div
      className="composite-encode-preview"
      title="Muted live preview — same image as encoded (not an extra overlay)"
      role="presentation"
    >
      <video
        ref={ref}
        className="composite-encode-preview__video"
        autoPlay
        muted
        playsInline
      />
      <span className="composite-encode-preview__label">Encoding preview</span>
    </div>
  );
}

function WebcamBubbleOverlay({
  stream,
}: {
  stream: MediaStream | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!stream) {
      el.srcObject = null;
      return undefined;
    }
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  if (!stream) return null;

  return (
    <div className="webcam-bubble" aria-hidden role="presentation">
      <video
        ref={ref}
        className="webcam-bubble__video"
        autoPlay
        muted
        playsInline
      />
    </div>
  );
}

function ConvexUploadEmbedded({
  blob,
  titlePlaceholder,
}: {
  blob: Blob;
  titlePlaceholder: string;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generateUploadUrl = useMutation(anyApi.recordings.generateUploadUrl);
  const finalizeRecording = useMutation(anyApi.recordings.finalizeRecording);

  const upload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const resolvedTitle =
        title.trim() || titlePlaceholder || `Recording ${new Date().toLocaleString()}`;

      const postUrl = await generateUploadUrl();
      const resp = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type || "video/webm" },
        body: blob,
      });
      const body = (await resp.json()) as { storageId?: string };
      if (!resp.ok) throw new Error(resp.statusText || "Upload failed.");
      if (typeof body.storageId !== "string") throw new Error("Invalid upload response.");

      let thumbId: GenericId<"_storage"> | undefined;
      try {
        const jpeg = await videoBlobToPosterJpeg(blob);
        const thumbPost = await generateUploadUrl();
        const tr = await fetch(thumbPost, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: jpeg,
        });
        const tb = (await tr.json()) as { storageId?: string };
        if (tr.ok && typeof tb.storageId === "string") {
          thumbId = tb.storageId as GenericId<"_storage">;
        }
      } catch {
        /* thumb optional */
      }

      await finalizeRecording({
        storageId: body.storageId as GenericId<"_storage">,
        thumbnailStorageId: thumbId,
        title: resolvedTitle,
        byteSize: blob.size,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }, [blob, finalizeRecording, generateUploadUrl, title, titlePlaceholder]);

  return (
    <div className="upload-block">
      <label className="field">
        <span>Cloud title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
        />
      </label>
      <button
        type="button"
        className="btn secondary"
        disabled={busy}
        onClick={() => void upload()}
      >
        {busy ? "Uploading…" : "Save to Convex"}
      </button>
      {err ? <p className="error-msg">{err}</p> : null}
    </div>
  );
}

function ConvexLibrary() {
  const rows = useQuery(anyApi.recordings.list);
  const remove = useMutation(anyApi.recordings.remove);

  return (
    <section className="card library-card" aria-labelledby="lib-title">
      <h2 id="lib-title">Saved in Convex</h2>
      {rows === undefined ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No recordings uploaded yet.</p>
      ) : (
        <ul className="recording-list">
          {rows.map((doc: ConvexRecordingDoc) => (
            <ConvexRecordingRow
              key={doc._id}
              id={doc._id}
              title={doc.title}
              createdMs={doc._creationTime}
              onRemove={() => remove({ id: doc._id })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConvexRecordingRow({
  id,
  title,
  createdMs,
  onRemove,
}: {
  id: GenericId<"recordings">;
  title: string;
  createdMs: number;
  onRemove: () => void;
}) {
  const url = useQuery(anyApi.recordings.getUrlByRecordingId, { id });
  const thumbUrl = useQuery(anyApi.recordings.getThumbnailUrlByRecordingId, { id });

  return (
    <li className="recording-item">
      {typeof thumbUrl === "string" && thumbUrl.length > 0 ? (
        <img className="recording-thumb" src={thumbUrl} alt="" loading="lazy" />
      ) : null}
      <div className="recording-body">
        <div className="recording-meta">
          <strong>{title}</strong>
          <span className="muted">{new Date(createdMs).toLocaleString()}</span>
        </div>
        <div className="recording-actions">
          {typeof url === "string" && url.length > 0 ? (
            <a className="btn ghost small" href={url} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          ) : (
            <span className="muted small-label">Fetching link…</span>
          )}
          <button type="button" className="btn danger small" onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
