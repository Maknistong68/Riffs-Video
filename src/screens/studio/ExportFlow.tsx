import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../app/haptics';
import { navigate } from '../../app/router';
import { formatBytes, formatDuration } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { db, getSettings, styleOf, updateSettings, type RiffRecord } from '../../storage/db';
import { updateRiff } from '../../storage/riffs';
import { WorkerError } from '../../workers/client';
import { runExport, type ExportRun } from '../../export/runExport';
import type { ExportStage, SoundMode } from '../../workers/protocol';

type Platform = 'tiktok' | 'shorts' | 'reels';
const COPYRIGHT =
  'Recreated audio of a famous song can still be claimed by the songwriter. For monetized videos use originals; for famous songs use Silent mode and add the official sound in TikTok.';

const STAGES: { key: ExportStage | 'verify'; label: string }[] = [
  { key: 'audio', label: 'Synthesising audio' },
  { key: 'render', label: 'Rendering & encoding video' },
  { key: 'verify', label: 'Checking sync (listening to the result)' },
];

export function ExportFlow({ riff, durationMs, onClose }: { riff: RiffRecord; durationMs: number; onClose: () => void }) {
  const [phase, setPhase] = useState<'sheet' | 'rendering'>('sheet');
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [fps, setFps] = useState(riff.styleSettings.fps);
  const [soundMode, setSoundMode] = useState<SoundMode>(riff.styleSettings.soundMode);
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    void getSettings(db()).then((s) => setShowNotice(!riff.isOriginal && !s.copyrightNoticeSeen));
  }, [riff.isOriginal]);

  const [perf, setPerf] = useState<number | null>(null);
  useEffect(() => {
    void getSettings(db()).then((s) => setPerf(s.perf?.[styleOf(riff).render.view]?.ratio ?? null));
  }, [riff]);
  const duration = durationMs / 1000;
  const estSize = duration * (fps === 60 ? 220_000 : 140_000);
  // Render+encode from this device's benchmark (measured at 30 fps), plus synth and the Sync Report.
  const renderSec = perf && perf > 0 ? (duration * (fps / 30)) / perf : duration * fps * 0.02;
  const estTime = Math.ceil(renderSec + duration * 1.5 + 6);

  if (phase === 'rendering') {
    return <Rendering riff={riff} fps={fps} soundMode={soundMode} onCancel={onClose} />;
  }
  return (
    <Sheet onClose={onClose} label="Export">
      <h2>Export video</h2>
      <div className="field"><span>Platform (all 1080×1920)</span>
        <Segmented<Platform> label="Platform" value={platform} onChange={setPlatform} options={[{ value: 'tiktok', label: 'TikTok' }, { value: 'shorts', label: 'Shorts' }, { value: 'reels', label: 'Reels' }]} />
      </div>
      <div className="field"><span>Frame rate</span>
        <Segmented<30 | 60> label="Frame rate" value={fps} onChange={setFps} options={[{ value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} />
      </div>
      <div className="field"><span>Sound</span>
        <Segmented<SoundMode> label="Sound" value={soundMode} onChange={setSoundMode} options={[{ value: 'synth', label: 'Synth' }, { value: 'synth-click', label: 'Synth + click' }, { value: 'silent', label: 'Silent' }]} />
      </div>
      {soundMode === 'silent' && (
        <p className="small dim">No audible sound: add the official track in TikTok. First note at {(styleOf(riff).silent.offsetMs / 1000).toFixed(2)} s{styleOf(riff).silent.bpm ? `, ${styleOf(riff).silent.bpm} bpm` : ''}.</p>
      )}
      <div className="row spread dim small"><span>Quality: High (H.264 + AAC)</span><span>~{formatBytes(estSize)} · ~{formatDuration(estTime * 1000)}</span></div>
      {showNotice && soundMode === 'synth' && <div className="notice">{COPYRIGHT}</div>}
      <button
        className="btn primary block"
        data-testid="start-export"
        onClick={() => {
          haptic();
          if (showNotice) void updateSettings(db(), { copyrightNoticeSeen: true });
          void updateRiff(riff.id, { styleSettings: { ...styleOf(riff), fps, soundMode } });
          setPhase('rendering');
        }}
      >
        Export
      </button>
    </Sheet>
  );
}

/** S7: progress, wake lock, cancel; saves the result and opens S8. */
function Rendering({ riff, fps, soundMode, onCancel }: { riff: RiffRecord; fps: 30 | 60; soundMode: SoundMode; onCancel: () => void }) {
  const [stage, setStage] = useState<ExportStage>('prepare');
  const [fraction, setFraction] = useState(0);
  const [frames, setFrames] = useState<{ frame: number; frames: number } | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [wasHidden, setWasHidden] = useState(false);
  const started = useRef(performance.now());
  const job = useRef<ExportRun | null>(null);

  useEffect(() => {
    let wake: WakeLockSentinel | null = null;
    const lock = () => navigator.wakeLock?.request('screen').then((w) => (wake = w), () => undefined);
    void lock();
    const onVis = () => {
      if (document.hidden) setWasHidden(true);
      else void lock();
    };
    document.addEventListener('visibilitychange', onVis);

    const j = runExport(riff, { fps, soundMode }, (s, f, frame, total) => {
      setStage(s);
      setFraction(f);
      if (frame !== undefined && total !== undefined) setFrames({ frame, frames: total });
    });
    job.current = j;
    let unmounted = false;
    j.promise.then(
      ({ exportId, ok }) => {
        if (unmounted) return;
        haptic(ok ? 30 : 80);
        navigate({ name: 'result', exportId });
      },
      (e: unknown) => {
        if (unmounted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(e instanceof WorkerError ? [e.message, ...e.details] : [e instanceof Error ? e.message : String(e)]);
      },
    );
    return () => {
      // Leaving the screen cancels the export (also keeps StrictMode's double effect from exporting twice).
      unmounted = true;
      j.cancel();
      document.removeEventListener('visibilitychange', onVis);
      void wake?.release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = (performance.now() - started.current) / 1000;
  const eta = stage === 'render' && fraction > 0.05 ? Math.ceil((elapsed / fraction) * (1 - fraction)) : null;
  const order = ['prepare', 'audio', 'render', 'verify'] as const;
  const cur = stage.startsWith('verify') ? 'verify' : stage;
  const idx = order.indexOf(cur as (typeof order)[number]);

  return (
    <div className="backdrop" style={{ alignItems: 'stretch' }}>
      <div className="sheet" style={{ borderRadius: 0, maxHeight: 'none', justifyContent: 'center', gap: 18 }} role="dialog" aria-label="Rendering" data-testid="rendering">
        <h1>{error ? 'Export failed' : 'Making your video…'}</h1>
        {error ? (
          <div className="errors" role="alert">{error.map((m, i) => <span key={i}>{m}</span>)}</div>
        ) : (
          <>
            <div className="bar" aria-label="Progress"><div style={{ width: `${Math.round(((Math.max(0, idx - 1) + (cur === 'render' ? fraction : cur === 'verify' ? 0.5 : fraction)) / 3) * 100)}%` }} /></div>
            <ul className="steps">
              {STAGES.map((s, i) => (
                <li key={s.key} className={i + 1 < idx ? 'done' : i + 1 === idx ? 'on' : ''}>
                  <span aria-hidden="true">{i + 1 < idx ? '✓' : i + 1 === idx ? '●' : '○'}</span>
                  {s.label}
                  {s.key === 'render' && i + 1 === idx && frames ? ` — frame ${frames.frame}/${frames.frames}${eta !== null ? `, ~${eta} s left` : ''}` : ''}
                </li>
              ))}
            </ul>
            <p className="dim small">Keep RiffReel open and the screen on — iPhones pause rendering when the app goes to the background.</p>
            {wasHidden && <div className="notice small">The app was in the background; rendering may have paused. It continues now.</div>}
          </>
        )}
        <button className="btn block" onClick={() => { job.current?.cancel(); onCancel(); }}>{error ? 'Back to studio' : 'Cancel'}</button>
      </div>
    </div>
  );
}
