import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderBeeps } from '../audio/beeps';
import { AUDIO_SAMPLE_RATE, frameCount, samplesForFrames } from '../engine/time';
import { validateTimeline } from '../engine/timeline';
import type { ExportInfo } from '../export/exporter';
import type { SyncReport } from '../export/syncCheck';
import { defaultFrameSettings, drawFrame } from '../render/drawFrame';
import type { RenderRequest, RenderResponse } from '../workers/render.worker';
import { demoTimeline } from './demoTimeline';

type Phase =
  | { kind: 'idle' }
  | { kind: 'rendering'; stage: 'render' | 'verify'; frame: number; frames: number; startedAt: number }
  | { kind: 'done'; url: string; blob: Blob; info: ExportInfo; report: SyncReport }
  | { kind: 'error'; message: string };

type Compat = { ok: boolean; missing: string[] };

function checkCompat(): Compat {
  const missing: string[] = [];
  if (typeof VideoEncoder === 'undefined') missing.push('VideoEncoder (WebCodecs)');
  if (typeof AudioEncoder === 'undefined') missing.push('AudioEncoder (WebCodecs)');
  if (typeof OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas');
  if (typeof Worker === 'undefined') missing.push('Web Workers');
  return { ok: missing.length === 0, missing };
}

export function SpikeApp() {
  const timeline = useMemo(demoTimeline, []);
  const issues = useMemo(() => validateTimeline(timeline), [timeline]);
  const [fps, setFps] = useState<30 | 60>(30);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [playing, setPlaying] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const compat = useMemo(checkCompat, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; t0: number } | null>(null);
  const rafRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  const frames = frameCount(timeline.durationMs, fps);
  const settings = useMemo(() => ({ ...defaultFrameSettings(fps), showSafeZones: showSafe }), [fps, showSafe]);
  const [frame, setFrame] = useState(0);

  // Preview: the SAME pure drawFrame as the export.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawFrame(ctx, timeline, frame, settings);
  }, [frame, settings, timeline]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const a = audioRef.current;
    if (a) {
      a.src.onended = null;
      a.src.stop();
      void a.ctx.close();
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stop();
    const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    const total = samplesForFrames(frames, fps);
    const pcm = renderBeeps(timeline, total, AUDIO_SAMPLE_RATE);
    const buf = ctx.createBuffer(1, total, AUDIO_SAMPLE_RATE);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    src.start(t0);
    src.onended = () => stop();
    audioRef.current = { ctx, src, t0 };
    setPlaying(true);
    // The preview clock is the audio clock, so preview visuals follow what you hear.
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      const sec = Math.max(0, a.ctx.currentTime - a.t0 - a.ctx.outputLatency);
      setFrame(Math.min(frames - 1, Math.floor(sec * fps)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [fps, frames, stop, timeline]);

  useEffect(() => () => stop(), [stop]);

  const startExport = useCallback(() => {
    stop();
    if (phase.kind === 'done') URL.revokeObjectURL(phase.url);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const startedAt = performance.now();
    setPhase({ kind: 'rendering', stage: 'render', frame: 0, frames, startedAt });
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request('screen').then((w) => (wakeLock = w), () => undefined);
    worker.onmessage = (ev: MessageEvent<RenderResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        setPhase({ kind: 'rendering', stage: m.stage, frame: m.frame, frames: m.frames, startedAt });
        return;
      }
      void wakeLock?.release();
      worker.terminate();
      workerRef.current = null;
      if (m.type === 'error') {
        setPhase({ kind: 'error', message: m.message });
      } else {
        const blob = new Blob([m.mp4], { type: 'video/mp4' });
        setPhase({ kind: 'done', url: URL.createObjectURL(blob), blob, info: m.info, report: m.report });
        navigator.vibrate?.(30);
      }
    };
    worker.onerror = (e) => setPhase({ kind: 'error', message: e.message || 'Worker crashed' });
    const req: RenderRequest = { type: 'export', timeline, fps };
    worker.postMessage(req);
  }, [fps, frames, phase, stop, timeline]);

  const share = useCallback(async (blob: Blob) => {
    const file = new File([blob], 'riffreel-spike.mp4', { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: timeline.title });
        return;
      } catch {
        /* cancelled — fall through to download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }, [timeline.title]);

  if (!compat.ok) {
    return (
      <main className="screen">
        <h1>Please update your browser</h1>
        <p>RiffReel makes videos on your phone and needs iOS Safari 26+ or a recent Chrome / Samsung Internet.</p>
        <p className="dim">Missing: {compat.missing.join(', ')}</p>
      </main>
    );
  }

  const busy = phase.kind === 'rendering';
  return (
    <main className="screen">
      <header className="top">
        <h1>RiffReel <span className="tag">Phase 0 spike</span></h1>
        {issues.length > 0 && <p className="bad">Timeline invalid: {issues.map((i) => i.message).join('; ')}</p>}
      </header>

      <div className="preview">
        <canvas ref={canvasRef} width={settings.width} height={settings.height} data-testid="preview" />
      </div>

      <section className="panel">
        <input
          className="scrub"
          type="range"
          min={0}
          max={frames - 1}
          value={frame}
          aria-label="Scrub"
          onChange={(e) => { stop(); setFrame(Number(e.target.value)); }}
        />
        <div className="row">
          <button className="btn" onClick={playing ? stop : play} disabled={busy}>
            {playing ? '⏸ Pause' : '▶︎ Play'}
          </button>
          <div className="seg" role="group" aria-label="Frame rate">
            {([30, 60] as const).map((v) => (
              <button key={v} className={v === fps ? 'on' : ''} onClick={() => setFps(v)} disabled={busy}>
                {v} fps
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} /> Safe zones
          </label>
        </div>

        {phase.kind === 'rendering' && <Progress phase={phase} />}
        {phase.kind === 'error' && <p className="bad" role="alert">Export failed: {phase.message}</p>}
        {phase.kind === 'done' && <Result phase={phase} onShare={() => void share(phase.blob)} />}

        <button className="btn primary" onClick={startExport} disabled={busy} data-testid="export">
          {busy ? 'Rendering…' : 'Export MP4'}
        </button>
        {busy && <p className="dim small">Keep this screen open — iOS pauses rendering in the background.</p>}
      </section>
    </main>
  );
}

function Progress({ phase }: { phase: Extract<Phase, { kind: 'rendering' }> }) {
  const pct = phase.stage === 'verify' ? 100 : Math.round((phase.frame / phase.frames) * 100);
  const elapsed = (performance.now() - phase.startedAt) / 1000;
  const eta = phase.frame > 0 && phase.stage === 'render' ? (elapsed / phase.frame) * (phase.frames - phase.frame) : null;
  return (
    <div className="progress" data-testid="progress">
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="dim small">
        {phase.stage === 'verify'
          ? 'Checking sync…'
          : `Frame ${phase.frame} / ${phase.frames}${eta !== null ? ` · ~${Math.ceil(eta)} s left` : ''}`}
      </p>
    </div>
  );
}

function Result({ phase, onShare }: { phase: Extract<Phase, { kind: 'done' }>; onShare: () => void }) {
  const { report, info } = phase;
  const visualOk = report.highlights.filter((h) => h.ok).length;
  return (
    <div className="result">
      <video src={phase.url} controls playsInline className="player" data-testid="player" />
      <div className={`card ${report.ok ? 'good' : 'warn'}`} data-testid="sync-report" data-ok={String(report.ok)}>
        <strong>{report.ok ? '✅ In sync' : '⚠️ Sync problems'}</strong>
        <span> — {report.matched}/{report.total} beeps matched (±{report.toleranceMs.toFixed(1)} ms), max error {report.maxAbsErrorMs.toFixed(1)} ms</span>
        <ul className="small">
          <li>Highlights on first frame: {visualOk}/{report.highlights.length}</li>
          {report.durations && (
            <li>Audio {report.durations.audioSec.toFixed(3)} s · video {report.durations.videoSec.toFixed(3)} s ({report.durations.ok ? 'ok' : 'mismatch'})</li>
          )}
          {report.extraOnsets.length > 0 && <li>Unexpected sounds at {report.extraOnsets.map((m) => m.toFixed(0)).join(', ')} ms</li>}
          {report.matches.filter((m) => !m.ok).map((m) => <li key={m.eventId}>Note {m.eventId} @ {m.expectedMs} ms not heard</li>)}
          {report.highlights.filter((h) => !h.ok).map((h) => <li key={h.eventId}>Note {h.eventId}: {h.detail} (frame {h.frame})</li>)}
        </ul>
        <p className="dim small">
          {info.frames} frames · {(info.sizeBytes / 1024).toFixed(0)} KB · {(info.elapsedMs / 1000).toFixed(1)} s · AAC {info.audioEncoder} (priming {info.audioLatencySamples} smp compensated)
        </p>
      </div>
      <button className="btn" onClick={onShare}>Share / Save</button>
    </div>
  );
}
