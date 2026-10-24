import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { DEFAULT_SOUND_PACK, SOUND_PACKS } from '../../audio/soundpacks';
import { formatDuration } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { frameToMs } from '../../engine/time';
import { tuningLabel } from '../../engine/tuning';
import { defaultFrameSettings, drawFrame } from '../../render/drawFrame';
import { loadRenderFonts } from '../../render/fonts';
import { db, type RiffRecord, type StyleSettings } from '../../storage/db';
import { riffSource, updateRiff } from '../../storage/riffs';
import { inspectSource, prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared, SoundMode, TrackInfo } from '../../workers/protocol';
import { ExportFlow } from './ExportFlow';
import { usePreview } from './usePreview';

type Tab = 'guitar' | 'sound' | 'layout' | 'text' | 'teach';

/** S5: live preview + style controls. */
export function StudioScreen({ riffId, atMs }: { riffId: string; atMs?: number }) {
  const riff = useLiveQuery(() => db().riffs.get(riffId), [riffId]);
  if (riff === undefined) return <main className="screen no-nav"><p className="dim">Loading…</p></main>;
  return <Studio riff={riff} {...(atMs !== undefined ? { atMs } : {})} />;
}

function Studio({ riff, atMs }: { riff: RiffRecord; atMs?: number }) {
  const style = riff.styleSettings;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [tab, setTab] = useState<Tab>('guitar');
  const [showSafe, setShowSafe] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const source = useMemo(() => riffSource(riff), [riff.sourceText, riff.sourceBytes, riff.fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => void loadRenderFonts().then(() => setFontReady(true)), []);

  useEffect(() => {
    void inspectSource(source).then((i) => setTracks(i.tracks), () => undefined);
  }, [source]);

  // Build timeline + synth audio in the worker whenever anything that affects them changes.
  useEffect(() => {
    let live = true;
    setError(null);
    prepareRiff({
      riff: { source, trackIndex: riff.trackIndex, leadInMs: style.leadInMs, title: riff.title },
      soundFontUrl: DEFAULT_SOUND_PACK.url,
      soundMode: style.soundMode,
    }).then(
      (p) => {
        if (!live) return;
        setPrepared(p);
        if (JSON.stringify(p.timeline) !== JSON.stringify(riff.timelineCache)) void updateRiff(riff.id, { timelineCache: p.timeline });
      },
      (e: unknown) => live && setError(e instanceof WorkerError ? [e.message, ...e.details] : [String(e)]),
    );
    return () => {
      live = false;
    };
  }, [source, riff.trackIndex, riff.title, style.leadInMs, style.soundMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const fps = style.fps;
  const pv = usePreview(prepared, fps, atMs ?? 0);
  const settings = useMemo(() => ({ ...defaultFrameSettings(fps), showSafeZones: showSafe }), [fps, showSafe]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && prepared) drawFrame(ctx, prepared.timeline, pv.frame, settings);
  }, [prepared, pv.frame, settings, fontReady]);

  const setStyle = (patch: Partial<StyleSettings>) => void updateRiff(riff.id, { styleSettings: { ...style, ...patch } });
  const t = prepared?.timeline;

  return (
    <main className="screen no-nav studio">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back to library" onClick={() => navigate({ name: 'library' })}>‹</button>
        <h1>{riff.title}</h1>
        <button className="btn primary" style={{ minHeight: 44, fontSize: 16 }} disabled={!prepared} onClick={() => { pv.stop(); setExporting(true); }} data-testid="open-export">
          Export
        </button>
      </div>

      <div className="preview-wrap">
        <canvas ref={canvasRef} width={settings.width} height={settings.height} data-testid="preview" aria-label="Video preview" />
      </div>

      {error && (
        <div className="errors" role="alert">
          {error.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}
      {prepared && prepared.warnings.length > 0 && (
        <div className="notice small">Some notes could not be matched to playback: {prepared.warnings.slice(0, 3).join('; ')}</div>
      )}

      <div className="transport">
        <button className="icon-btn" aria-label={pv.playing ? 'Pause' : 'Play'} onClick={pv.playing ? pv.stop : pv.play} disabled={!prepared} data-testid="play">
          {pv.playing ? '⏸' : '▶︎'}
        </button>
        <input type="range" min={0} max={pv.frames - 1} value={pv.frame} onChange={(e) => pv.seek(Number(e.target.value))} aria-label="Scrub" />
        <span className="time">{formatDuration(frameToMs(pv.frame, fps))} / {formatDuration(t?.durationMs ?? 0)}</span>
      </div>
      <Segmented<number> label="Preview speed" value={pv.speed} onChange={(v) => { pv.stop(); pv.setSpeed(v); }} options={[{ value: 0.5, label: '0.5×' }, { value: 0.75, label: '0.75×' }, { value: 1, label: '1×' }]} />

      <div className="tabs" role="tablist">
        {(['guitar', 'sound', 'layout', 'text', 'teach'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <section className="panel card" role="tabpanel">
        {tab === 'guitar' && (
          <>
            {tracks.length > 1 && (
              <label className="field">
                <span>Track</span>
                <select className="input" value={riff.trackIndex} onChange={(e) => void updateRiff(riff.id, { trackIndex: Number(e.target.value) })}>
                  {tracks.map((tr) => <option key={tr.index} value={tr.index}>{tr.name} ({tr.strings} strings)</option>)}
                </select>
              </label>
            )}
            <div className="row spread"><span className="dim">Tuning</span><strong>{t ? tuningLabel(t.tuning, t.capo) : '…'}</strong></div>
            <div className="row spread"><span className="dim">Skin</span><strong>Strat</strong></div>
            <p className="dim small">Tuning and capo come from the file. More skins and left-handed mode arrive in phase 2.</p>
          </>
        )}
        {tab === 'sound' && (
          <>
            <Segmented<SoundMode> label="Sound mode" value={style.soundMode} onChange={(v) => setStyle({ soundMode: v })} options={[{ value: 'synth', label: 'Synth' }, { value: 'synth-click', label: 'Synth + click' }]} />
            <label className="field">
              <span>Sound pack</span>
              <select className="input" value={DEFAULT_SOUND_PACK.id} disabled>
                {SOUND_PACKS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {prepared && <p className="dim small">Loudness normalised to {prepared.lufs.toFixed(1)} LUFS.</p>}
          </>
        )}
        {tab === 'layout' && (
          <>
            <div className="row spread"><span className="dim">Preset</span><strong>Classic</strong></div>
            <label className="switch">
              <span>Show TikTok safe zones</span>
              <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
            </label>
            <p className="dim small">Neck-Overlay, Split and Close-up presets arrive in phase 2.</p>
          </>
        )}
        {tab === 'text' && (
          <>
            <label className="field">
              <span>Title</span>
              <input className="input" defaultValue={riff.title} onBlur={(e) => e.target.value.trim() && e.target.value !== riff.title && void updateRiff(riff.id, { title: e.target.value.trim() })} />
            </label>
            <label className="switch">
              <span>This is my original riff</span>
              <input type="checkbox" checked={riff.isOriginal} onChange={(e) => void updateRiff(riff.id, { isOriginal: e.target.checked })} />
            </label>
          </>
        )}
        {tab === 'teach' && <p className="dim">Slow-mo passes, loop the hardest bar, finger numbers and pick arrows arrive in phase 2.</p>}
      </section>

      {exporting && prepared && (
        <ExportFlow riff={riff} source={source} onClose={() => setExporting(false)} />
      )}
    </main>
  );
}
