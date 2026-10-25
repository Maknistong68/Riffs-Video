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
import { isPlainTeach } from '../../engine/teach';
import { SKIN_IDS, SKINS } from '../../render/skins';
import { LAYOUTS, type DifficultyBadge, type EndCard, type LayoutId, type RenderStyle } from '../../render/style';
import { db, drumsOf, getSettings, styleOf, toneOf, updateSettings, type RiffRecord, type StyleSettings } from '../../storage/db';
import { toneForSkin, tonePreset } from '../../audio/tone';
import { ToneControls } from './ToneControls';
import { copyText, makePracticeLink } from '../../export/practice';
import { barCount, partRanges, splitIntoParts } from '../../export/splitParts';
import { DRUM_PATTERNS } from '../../audio/drums';
import { GENRES } from './genres';
import { THEME_NAMES, THEMES, type ThemeId } from '../../render/theme';
import { riffSource, updateRiff } from '../../storage/riffs';
import { benchmarkRender, inspectSource, prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared, SoundMode, TrackInfo } from '../../workers/protocol';
import { ExportFlow } from './ExportFlow';
import { SilentControls } from './SilentControls';
import { riffConfig } from '../../storage/riffConfig';
import { readBlob } from '../../storage/opfs';
import { usePreview } from './usePreview';

type Tab = 'guitar' | 'sound' | 'layout' | 'text' | 'teach';

/** The first-use speed check can be turned off for automated tests (VITE_BENCHMARK=off); a test re-enables it per page. */
function benchmarkEnabled(): boolean {
  try {
    if (localStorage.getItem('riffreel.benchmark') === 'on') return true;
  } catch {
    /* storage blocked */
  }
  return import.meta.env.VITE_BENCHMARK !== 'off';
}

/** Below this render speed (× real time) 3D is too slow for comfortable exports (CLAUDE.md phase 5). */
const MIN_3D_SPEED = 0.5;

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
  const drums = drumsOf(style);
  const configKey = JSON.stringify({ ...config, source: undefined, mode: style.soundMode, tone, drums });
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
      drums,
    }).then(
      (p) => {
        if (!live) return;
        setPrepared(p);
        if (isPlainTeach(style.teach) && JSON.stringify(p.timeline) !== JSON.stringify(riff.timelineCache)) {
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

  // P14: measure render speed once per device (first 3D use); too slow → this riff uses 2D.
  const appSettings = useLiveQuery(() => getSettings(db()), []);
  const perf3d = appSettings?.perf?.['3d'];
  const benchStarted = useRef(false);
  useEffect(() => {
    if (!benchmarkEnabled() || !prepared || !appSettings || style.render.view !== '3d' || neck3d !== 'ready' || perf3d || benchStarted.current) return;
    benchStarted.current = true;
    void (async () => {
      const r3 = await benchmarkRender({ ...style.render, view: '3d' }).catch(() => null);
      const r2 = await benchmarkRender({ ...style.render, view: '2d' }).catch(() => null);
      const now = Date.now();
      const s = await getSettings(db());
      await updateSettings(db(), {
        perf: { ...s.perf, '3d': { ratio: r3?.supported ? r3.ratio : 0, measuredAt: now }, ...(r2?.supported ? { '2d': { ratio: r2.ratio, measuredAt: now } } : {}) },
      });
    })();
  }, [prepared, appSettings, style.render, neck3d, perf3d]);
  const tooSlow3d = perf3d !== undefined && perf3d.ratio < MIN_3D_SPEED;
  useEffect(() => {
    if (tooSlow3d && style.render.view === '3d' && !style.force3d) setRender({ view: '2d' });
  }, [tooSlow3d, style.render.view, style.force3d]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {tooSlow3d && !is3d && !style.force3d && (
        <div className="notice small" data-testid="slow-3d">
          3D renders at {perf3d!.ratio.toFixed(1)}× real time on this phone, so this riff uses 2D (exports would take {Math.max(2, Math.round(1 / Math.max(0.05, perf3d!.ratio)))}× the video length).{' '}
          <button className="btn" onClick={() => setStyle({ force3d: true, render: { ...render, view: '3d' } })}>Use 3D anyway</button>
        </div>
      )}
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
                <Segmented<CameraMotion> label="Camera motion" value={render.camera.motion} onChange={(motion) => setRender({ camera: { ...render.camera, motion } })} options={[{ value: 'static', label: 'Still' }, { value: 'follow', label: 'Follow hand' }, { value: 'orbit', label: 'Slow orbit' }]} />
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
            <div className="field" data-testid="drum-controls">
              <span>Drums</span>
              <div className="chips" role="radiogroup" aria-label="Drum pattern">
                {DRUM_PATTERNS.map((d) => (
                  <button key={d.id} role="radio" aria-checked={drums.pattern === d.id} className={`chip ${drums.pattern === d.id ? 'on' : ''}`} onClick={() => setStyle({ drums: { ...drums, pattern: d.id } })}>
                    {d.name}
                  </button>
                ))}
              </div>
              {drums.pattern !== 'none' && (
                <label className="knob">
                  <span>Drum volume<b>{Math.round(drums.volume * 10)}</b></span>
                  <input type="range" min={0} max={1} step={0.05} value={drums.volume} aria-label="Drum volume" onChange={(e) => setStyle({ drums: { ...drums, volume: Number(e.target.value) } })} />
                </label>
              )}
            </div>
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
            <div className="field" data-testid="genre-controls">
              <span>Genre (sets colours, guitar tone and drums)</span>
              <div className="chips" role="group" aria-label="Genre" style={{ flexWrap: 'wrap' }}>
                {GENRES.map((g) => (
                  <button key={g.id} className={`chip ${render.theme === g.theme && tone.preset === g.tone && drums.pattern === g.drums ? 'on' : ''}`} onClick={() => setStyle({ render: { ...render, theme: g.theme }, tone: tonePreset(g.tone), drums: { ...drums, pattern: g.drums } })}>
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Colours</span>
              <div className="chips" role="radiogroup" aria-label="Colour theme">
                {(Object.keys(THEME_NAMES) as ThemeId[]).map((id) => (
                  <button key={id} role="radio" aria-checked={render.theme === id} className={`chip ${render.theme === id ? 'on' : ''}`} onClick={() => setRender({ theme: id })}>
                    <span className="swatch" style={{ background: THEMES[id].dot }} />{THEME_NAMES[id]}
                  </button>
                ))}
              </div>
            </div>
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
            <label className="switch"><span>Bar counter</span><input type="checkbox" checked={render.barCounter} onChange={(e) => setRender({ barCounter: e.target.checked })} /></label>
            <label className="switch"><span>Fretboard heatmap at the end</span><input type="checkbox" checked={render.heatmap} onChange={(e) => setRender({ heatmap: e.target.checked })} data-testid="heatmap" /></label>
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
              <Segmented<DifficultyBadge> label="Difficulty badge" value={render.difficulty} onChange={(v) => setRender({ difficulty: v })} options={[{ value: 'none', label: 'None' }, { value: 'auto', label: 'Auto' }, { value: 'Easy', label: 'Easy' }, { value: 'Medium', label: 'Med' }, { value: 'Hard', label: 'Hard' }]} />
            </div>
            <div className="field">
              <span>Opener</span>
              <Segmented<'none' | 'guess'> label="Opener" value={render.opener} onChange={(v) => setRender({ opener: v })} options={[{ value: 'none', label: 'None' }, { value: 'guess', label: 'Guess the song?' }]} />
              {render.opener === 'guess' && <p className="small dim">The title stays hidden behind a 3-2-1 countdown and is revealed at the end.</p>}
            </div>
            <div className="field" data-testid="endcard-controls">
              <span>End card</span>
              <Segmented<EndCard['kind']> label="End card" value={render.endCard.kind} onChange={(kind) => setRender({ endCard: { ...render.endCard, kind } })} options={[{ value: 'none', label: 'None' }, { value: 'follow', label: 'Follow' }, { value: 'part', label: 'Part X of Y' }]} />
              {render.endCard.kind === 'part' && (
                <div className="row">
                  <label className="field" style={{ flex: 1 }}><span>Part</span><input className="input" type="number" min={1} max={20} value={render.endCard.part ?? 1} onChange={(e) => setRender({ endCard: { ...render.endCard, part: Math.max(1, Number(e.target.value) || 1) } })} /></label>
                  <label className="field" style={{ flex: 1 }}><span>of</span><input className="input" type="number" min={1} max={20} value={render.endCard.parts ?? 2} onChange={(e) => setRender({ endCard: { ...render.endCard, parts: Math.max(1, Number(e.target.value) || 1) } })} /></label>
                </div>
              )}
              {render.endCard.kind !== 'none' && (
                <input className="input" defaultValue={render.endCard.text} placeholder={render.endCard.kind === 'follow' ? 'Follow for more riffs' : 'Part 2 on my profile'} aria-label="End card text" onBlur={(e) => e.target.value !== render.endCard.text && setRender({ endCard: { ...render.endCard, text: e.target.value.trim() } })} />
              )}
            </div>
            <PracticeLinkButton riff={riff} />
            <label className="switch"><span>This is my original riff</span><input type="checkbox" checked={riff.isOriginal} onChange={(e) => void updateRiff(riff.id, { isOriginal: e.target.checked })} /></label>
          </>
        )}
        {tab === 'teach' && (
          <>
            {silentMode && <p className="small warn">Teach passes are off in Silent mode (they would drift from the official sound).</p>}
            <label className="switch"><span>Hook first (full speed, then teach)</span><input type="checkbox" checked={!!style.teach.hookFirst} onChange={(e) => setStyle({ teach: { ...style.teach, hookFirst: e.target.checked } })} data-testid="teach-hook" /></label>
            <label className="switch"><span>Slow-mo passes (50% → 75% → 100%)</span><input type="checkbox" checked={style.teach.slowMo} onChange={(e) => setStyle({ teach: { ...style.teach, slowMo: e.target.checked } })} data-testid="teach-slowmo" /></label>
            <label className="switch">
              <span>Loop hardest bar ×3{hardest ? ` (bar ${hardest.barIndex + 1})` : ''}</span>
              <input type="checkbox" checked={style.teach.loopHardest} onChange={(e) => setStyle({ teach: { ...style.teach, loopHardest: e.target.checked } })} data-testid="teach-loop" />
            </label>
            <label className="switch">
              <span>Same riff in 3 positions (other places on the neck, same notes)</span>
              <input type="checkbox" checked={!!style.teach.positions} onChange={(e) => setStyle({ teach: { ...style.teach, positions: e.target.checked } })} data-testid="teach-positions" />
            </label>
            <SplitParts riff={riff} />
            <label className="switch"><span>Finger numbers on the dots</span><input type="checkbox" checked={render.fingerNumbers} onChange={(e) => setRender({ fingerNumbers: e.target.checked })} /></label>
            <label className="switch"><span>Pick strokes (from the file)</span><input type="checkbox" checked={render.pickArrows} onChange={(e) => setRender({ pickArrows: e.target.checked })} /></label>
            <label className="switch"><span>Note names</span><input type="checkbox" checked={render.noteNames} onChange={(e) => setRender({ noteNames: e.target.checked })} /></label>
          </>
        )}
      </section>

      {exporting && prepared && <ExportFlow riff={riff} durationMs={prepared.timeline.durationMs} onClose={() => setExporting(false)} />}
    </main>
  );
}

/** "Part 1 / Part 2" videos: split into N-bar parts with end cards, queued for export. */
function SplitParts({ riff }: { riff: RiffRecord }) {
  const [per, setPer] = useState(4);
  const [busy, setBusy] = useState(false);
  const bars = barCount(riff);
  const parts = partRanges(bars, per).length;
  if (bars < 2) return null;
  return (
    <div className="field" data-testid="split-parts">
      <span>Split into parts ({bars} bars)</span>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>Bars per part</span>
          <input className="input" type="number" min={1} max={bars} value={per} onChange={(e) => setPer(Math.max(1, Math.min(bars, Number(e.target.value) || 1)))} aria-label="Bars per part" />
        </label>
        <button
          className="btn"
          style={{ flex: 1, alignSelf: 'flex-end' }}
          disabled={busy || parts < 2}
          data-testid="split-go"
          onClick={async () => {
            setBusy(true);
            await splitIntoParts(riff, per);
            navigate({ name: 'exports' });
          }}
        >
          {parts < 2 ? 'Nothing to split' : `Make ${parts} part videos`}
        </button>
      </div>
      <p className="small dim">Each part gets a “Part X of {Math.max(2, parts)}” end card and joins the export queue.</p>
    </div>
  );
}

/** Share the riff itself as a link: viewers can play it slower, loop it and save it. */
function PracticeLinkButton({ riff }: { riff: RiffRecord }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="field">
      <button
        className="btn"
        disabled={busy}
        data-testid="studio-practice-link"
        onClick={async () => {
          setBusy(true);
          const r = await makePracticeLink(riff);
          setBusy(false);
          setMsg(r.ok ? await copyText(r.url, 'Practice link copied — put it in your bio or caption') : r.message);
        }}
      >
        Copy practice link
      </button>
      {msg && <span className="small good" role="status" data-testid="practice-link-msg">{msg}</span>}
    </div>
  );
}
