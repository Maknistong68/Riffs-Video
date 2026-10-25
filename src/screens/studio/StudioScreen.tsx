import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { DEFAULT_SOUND_PACK, SOUND_PACKS } from '../../audio/soundpacks';
import { formatDuration } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { difficultyLabel, hardestBar } from '../../engine/difficulty';
import type { RiffEdit } from '../../engine/edits';
import { frameToMs } from '../../engine/time';
import { tuningLabel } from '../../engine/tuning';
import { defaultFrameSettings, drawFrame } from '../../render/drawFrame';
import { loadRenderFonts } from '../../render/fonts';
import { CAMERA_PRESETS, clampCamera, type Camera3D, type CameraMotion } from '../../render/camera';
import { ensureNeck3d } from '../../render/neck3dRegistry';
import { SKIN_IDS, SKINS } from '../../render/skins';
import { LAYOUTS, type DifficultyBadge, type LayoutId, type RenderStyle } from '../../render/style';
import { db, styleOf, toneOf, type RiffRecord, type StyleSettings } from '../../storage/db';
import { toneForSkin } from '../../audio/tone';
import { ToneControls } from './ToneControls';
import { riffSource, updateRiff } from '../../storage/riffs';
import { inspectSource, prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared, SoundMode, TrackInfo } from '../../workers/protocol';
import { ExportFlow } from './ExportFlow';
import { SilentControls } from './SilentControls';
import { riffConfig } from '../../storage/riffConfig';
import { readBlob } from '../../storage/opfs';
import { usePreview } from './usePreview';

type Tab = 'guitar' | 'sound' | 'layout' | 'text' | 'teach';

const TUNINGS: Record<number, { name: string; tuning: number[] }[]> = {
  6: [
    { name: 'Standard', tuning: [64, 59, 55, 50, 45, 40] },
    { name: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
    { name: 'Eb standard', tuning: [63, 58, 54, 49, 44, 39] },
    { name: 'D standard', tuning: [62, 57, 53, 48, 43, 38] },
    { name: 'Open G', tuning: [62, 59, 55, 50, 43, 38] },
    { name: 'DADGAD', tuning: [62, 57, 55, 50, 45, 38] },
  ],
  7: [{ name: '7-string standard', tuning: [64, 59, 55, 50, 45, 40, 35] }],
  4: [
    { name: 'Bass standard', tuning: [43, 38, 33, 28] },
    { name: 'Bass drop D', tuning: [43, 38, 33, 26] },
  ],
};

/** S5: live preview + style controls. */
export function StudioScreen({ riffId, atMs, openExport = false }: { riffId: string; atMs?: number; openExport?: boolean }) {
  const riff = useLiveQuery(() => db().riffs.get(riffId), [riffId]);
  useEffect(() => {
    // Accuracy gate: notes must be confirmed in Riff Review before styling.
    if (riff && !riff.reviewed && !riff.demoId) navigate({ name: 'review', riffId }, true);
  }, [riff, riffId]);
  if (riff === undefined || riff === null || (!riff.reviewed && !riff.demoId)) return <main className="screen no-nav"><p className="dim">Loading…</p></main>;
  return <Studio riff={riff} {...(atMs !== undefined ? { atMs } : {})} openExport={openExport} />;
}

function Studio({ riff, atMs, openExport }: { riff: RiffRecord; atMs?: number; openExport: boolean }) {
  // Optimistic style: controls update instantly; IndexedDB catches up in the background.
  const stored = styleOf(riff);
  const [style, setLocalStyle] = useState(stored);
  const storedKey = JSON.stringify(stored);
  useEffect(() => setLocalStyle(JSON.parse(storedKey) as StyleSettings), [storedKey]);
  const render = style.render;
  const edits = riff.edits ?? [];
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [tab, setTab] = useState<Tab>('guitar');
  const [showSafe, setShowSafe] = useState(false);
  const [exporting, setExporting] = useState(openExport);
  const [fontReady, setFontReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const source = useMemo(() => riffSource(riff), [riff.sourceText, riff.sourceBytes, riff.fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => void loadRenderFonts().then(() => setFontReady(true)), []);
  // three.js is loaded only when the 3D view is used.
  const [neck3d, setNeck3d] = useState<'idle' | 'ready' | 'failed'>('idle');
  useEffect(() => {
    if (style.render.view !== '3d' || neck3d !== 'idle') return;
    void ensureNeck3d().then((ok) => setNeck3d(ok ? 'ready' : 'failed'));
  }, [style.render.view, neck3d]);
  useEffect(() => {
    void inspectSource(source).then((i) => setTracks(i.tracks), () => undefined);
  }, [source]);

  // Timeline + synth audio (incl. teach passes) from the worker whenever they could change.
  // In Silent mode the preview still gets the synth as a guide (the export is silent).
  const config = riffConfig(riff, style);
  const tone = toneOf(style);
  const configKey = JSON.stringify({ ...config, source: undefined, mode: style.soundMode, tone });
  const silentMode = style.soundMode === 'silent';
  useEffect(() => {
    let live = true;
    setError(null);
    // Debounced: dragging a pedal knob re-renders the effects once the finger settles.
    const timer = window.setTimeout(() => prepareRiff({
      riff: config,
      soundFontUrl: DEFAULT_SOUND_PACK.url,
      soundMode: silentMode ? 'synth' : style.soundMode,
      tone,
    }).then(
      (p) => {
        if (!live) return;
        setPrepared(p);
        if (!style.teach.slowMo && !style.teach.loopHardest && JSON.stringify(p.timeline) !== JSON.stringify(riff.timelineCache)) {
          void updateRiff(riff.id, { timelineCache: p.timeline });
        }
      },
      (e: unknown) => live && setError(e instanceof WorkerError ? [e.message, ...e.details] : [String(e)]),
    ), prepared ? 250 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [source, configKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent mode reference recording, decoded once for the preview transport.
  const [reference, setReference] = useState<AudioBuffer | null>(null);
  useEffect(() => {
    const path = style.silent.refPath;
    if (!silentMode || !path) return setReference(null);
    let live = true;
    void readBlob(db(), path, '').then(async (b) => {
      if (!b || !live) return;
      try {
        const buf = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(await b.arrayBuffer());
        if (live) setReference(buf);
      } catch {
        if (live) setError(['Could not read the reference recording.']);
      }
    });
    return () => {
      live = false;
    };
  }, [silentMode, style.silent.refPath]);
  const previewRef = useMemo(
    () => (silentMode && reference ? { buffer: reference, startSec: (style.silent.refStartMs - style.silent.offsetMs) / 1000 } : null),
    [silentMode, reference, style.silent.refStartMs, style.silent.offsetMs],
  );

  const fps = style.fps;
  const pv = usePreview(prepared, fps, atMs ?? 0, previewRef);
  const settings = useMemo(() => ({ ...defaultFrameSettings(fps, render), showSafeZones: showSafe }), [fps, render, showSafe]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && prepared) drawFrame(ctx, prepared.timeline, pv.frame, settings);
  }, [prepared, pv.frame, settings, fontReady, neck3d]);

  // Drag the preview to turn the guitar (3D view). Live while dragging, saved on release.
  const drag = useRef<{ x: number; y: number; cam: Camera3D; scale: number } | null>(null);
  const is3d = render.view === '3d';
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!is3d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, cam: render.camera, scale: 140 / Math.max(1, rect.width) };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const camera = clampCamera({ ...d.cam, yaw: d.cam.yaw - (e.clientX - d.x) * d.scale, pitch: d.cam.pitch + (e.clientY - d.y) * d.scale });
    setLocalStyle((st) => ({ ...st, render: { ...st.render, camera } }));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setStyle({ render: { ...render } });
  };

  const setStyle = (patch: Partial<StyleSettings>) => {
    const next = { ...style, ...patch };
    setLocalStyle(next);
    void updateRiff(riff.id, { styleSettings: next });
  };
  const setRender = (patch: Partial<RenderStyle>) => setStyle({ render: { ...render, ...patch } });
  /** Tuning / capo are score edits too (the sound changes with them); keep only the latest of each kind. */
  const setGlobalEdit = (e: Extract<RiffEdit, { kind: 'tuning' | 'capo' }>) =>
    void updateRiff(riff.id, { edits: [...edits.filter((x) => x.kind !== e.kind), e], timelineCache: undefined });

  const t = prepared?.timeline;
  const base = riff.timelineCache ?? t;
  const suggested = base ? difficultyLabel(base) : null;
  const hardest = base ? hardestBar(base) : null;
  const tunings = TUNINGS[t?.tuning.length ?? 6] ?? [];
  const tuningPreset = tunings.find((x) => x.tuning.join() === t?.tuning.join())?.name ?? 'custom';

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
        <canvas
          ref={canvasRef}
          width={settings.width}
          height={settings.height}
          data-testid="preview"
          aria-label={is3d ? 'Video preview — drag to turn the guitar' : 'Video preview'}
          style={is3d ? { touchAction: 'none', cursor: 'grab' } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      {is3d && <p className="dim small center">Drag the preview to turn the guitar.</p>}
      {is3d && neck3d === 'failed' && (
        <div className="notice small">This device can’t draw the 3D guitar (no WebGL). <button className="btn" onClick={() => setRender({ view: '2d' })}>Use 2D</button></div>
      )}

      {error && <div className="errors" role="alert">{error.map((m, i) => <span key={i}>{m}</span>)}</div>}
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
            <Segmented<'2d' | '3d'> label="View" value={render.view} onChange={(v) => setRender({ view: v })} options={[{ value: '3d', label: '3D guitar' }, { value: '2d', label: 'Flat 2D' }]} />
            {is3d && (
              <>
                <div className="field">
                  <span>Camera angle (or drag the preview)</span>
                  <div className="chips" role="radiogroup" aria-label="Camera angle">
                    {CAMERA_PRESETS.map((p) => {
                      const on = Math.round(render.camera.yaw) === p.yaw && Math.round(render.camera.pitch) === p.pitch;
                      return (
                        <button key={p.id} role="radio" aria-checked={on} className={`chip ${on ? 'on' : ''}`} onClick={() => setRender({ camera: { ...render.camera, yaw: p.yaw, pitch: p.pitch } })}>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Segmented<CameraMotion> label="Camera motion" value={render.camera.motion} onChange={(motion) => setRender({ camera: { ...render.camera, motion } })} options={[{ value: 'static', label: 'Still' }, { value: 'orbit', label: 'Slow orbit' }]} />
              </>
            )}
            <label className="field">
              <span>Guitar</span>
              <select className="input" value={render.skin} onChange={(e) => setRender({ skin: e.target.value as RenderStyle['skin'] })} aria-label="Guitar skin">
                {SKIN_IDS.map((id) => <option key={id} value={id}>{SKINS[id].name}</option>)}
              </select>
            </label>
            {tracks.length > 1 && (
              <label className="field">
                <span>Track</span>
                <select className="input" value={riff.trackIndex} onChange={(e) => void updateRiff(riff.id, { trackIndex: Number(e.target.value), edits: [], reviewed: false })}>
                  {tracks.map((tr) => <option key={tr.index} value={tr.index}>{tr.name} ({tr.strings} strings)</option>)}
                </select>
              </label>
            )}
            {tunings.length > 0 && (
              <label className="field">
                <span>Tuning (retunes the strings: same frets, new pitches)</span>
                <select className="input" value={tuningPreset} onChange={(e) => { const p = tunings.find((x) => x.name === e.target.value); if (p) setGlobalEdit({ kind: 'tuning', tuning: p.tuning }); }} aria-label="Tuning">
                  {tuningPreset === 'custom' && <option value="custom">{t ? tuningLabel(t.tuning, 0) : 'From file'}</option>}
                  {tunings.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>
              </label>
            )}
            <div className="row spread">
              <span>Capo</span>
              <div className="row">
                <button className="btn" aria-label="Capo down" disabled={!t || t.capo <= 0} onClick={() => t && setGlobalEdit({ kind: 'capo', capo: t.capo - 1 })}>−</button>
                <strong style={{ minWidth: 28, textAlign: 'center' }}>{t?.capo ?? 0}</strong>
                <button className="btn" aria-label="Capo up" disabled={!t || t.capo >= 12} onClick={() => t && setGlobalEdit({ kind: 'capo', capo: t.capo + 1 })}>+</button>
              </div>
            </div>
            <label className="switch"><span>Left-handed (mirror the neck)</span><input type="checkbox" checked={render.leftHanded} onChange={(e) => setRender({ leftHanded: e.target.checked })} /></label>
            <button className="btn" onClick={() => navigate({ name: 'review', riffId: riff.id })}>Edit notes (Riff Review)</button>
          </>
        )}
        {tab === 'sound' && (
          <>
            <Segmented<SoundMode> label="Sound mode" value={style.soundMode} onChange={(v) => setStyle({ soundMode: v })} options={[{ value: 'synth', label: 'Synth' }, { value: 'synth-click', label: 'Synth + click' }, { value: 'silent', label: 'Silent' }]} />
            {silentMode && (
              <SilentControls silent={style.silent} riffBpm={Math.round(riff.timelineCache?.tempoMap[0]?.bpm ?? t?.tempoMap[0]?.bpm ?? 120)} reference={reference} onChange={(silent) => setStyle({ silent })} />
            )}
            {silentMode ? (
              <p className="dim small">The preview plays this tone as a guide; the export is silent.</p>
            ) : null}
            <ToneControls tone={tone} onChange={(t) => setStyle({ tone: t })} />
            {style.tone && (
              <button className="btn" onClick={() => setStyle({ tone: toneForSkin(render.skin) })}>Reset to the {SKINS[render.skin].name} default</button>
            )}
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
            <div className="field">
              <span>Preset</span>
              <div className="grid">
                {LAYOUTS.map((l) => (
                  <button key={l.id} className={`btn ${render.layout === l.id ? 'primary' : ''}`} style={{ minHeight: 48, fontSize: 15 }} aria-pressed={render.layout === l.id} onClick={() => setRender({ layout: l.id as LayoutId })}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="switch"><span>Show next notes (look-ahead)</span><input type="checkbox" checked={render.lookAhead} onChange={(e) => setRender({ lookAhead: e.target.checked })} /></label>
            <label className="switch"><span>Show TikTok safe zones (preview only)</span><input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} /></label>
          </>
        )}
        {tab === 'text' && (
          <>
            <label className="field">
              <span>Title</span>
              <input className="input" defaultValue={riff.title} onBlur={(e) => e.target.value.trim() && e.target.value !== riff.title && void updateRiff(riff.id, { title: e.target.value.trim() })} />
            </label>
            <label className="field">
              <span>Artist credit</span>
              <input className="input" defaultValue={render.credit} placeholder="e.g. Original by @you" onBlur={(e) => e.target.value !== render.credit && setRender({ credit: e.target.value.trim() })} />
            </label>
            <div className="field">
              <span>Difficulty badge{suggested ? ` (suggested: ${suggested})` : ''}</span>
              <Segmented<DifficultyBadge> label="Difficulty badge" value={render.difficulty} onChange={(v) => setRender({ difficulty: v })} options={[{ value: 'none', label: 'None' }, { value: 'Easy', label: 'Easy' }, { value: 'Medium', label: 'Medium' }, { value: 'Hard', label: 'Hard' }]} />
            </div>
            <label className="switch"><span>This is my original riff</span><input type="checkbox" checked={riff.isOriginal} onChange={(e) => void updateRiff(riff.id, { isOriginal: e.target.checked })} /></label>
          </>
        )}
        {tab === 'teach' && (
          <>
            {silentMode && <p className="small warn">Teach passes are off in Silent mode (they would drift from the official sound).</p>}
            <label className="switch"><span>Slow-mo passes (50% → 75% → 100%)</span><input type="checkbox" checked={style.teach.slowMo} onChange={(e) => setStyle({ teach: { ...style.teach, slowMo: e.target.checked } })} data-testid="teach-slowmo" /></label>
            <label className="switch">
              <span>Loop hardest bar ×3{hardest ? ` (bar ${hardest.barIndex + 1})` : ''}</span>
              <input type="checkbox" checked={style.teach.loopHardest} onChange={(e) => setStyle({ teach: { ...style.teach, loopHardest: e.target.checked } })} data-testid="teach-loop" />
            </label>
            <label className="switch"><span>Finger numbers on the dots</span><input type="checkbox" checked={render.fingerNumbers} onChange={(e) => setRender({ fingerNumbers: e.target.checked })} /></label>
            <label className="switch"><span>Pick strokes (from the file)</span><input type="checkbox" checked={render.pickArrows} onChange={(e) => setRender({ pickArrows: e.target.checked })} /></label>
            <label className="switch"><span>Note names</span><input type="checkbox" checked={render.noteNames} onChange={(e) => setRender({ noteNames: e.target.checked })} /></label>
          </>
        )}
      </section>

      {exporting && prepared && <ExportFlow riff={riff} source={source} durationMs={prepared.timeline.durationMs} onClose={() => setExporting(false)} />}
    </main>
  );
}
