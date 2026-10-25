import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { DEFAULT_SOUND_PACK } from '../../audio/soundpacks';
import { tonePreset } from '../../audio/tone';
import { formatDuration } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { frameToMs } from '../../engine/time';
import { decodePractice, type PracticePayload } from '../../import/practiceLink';
import { defaultFrameSettings, drawFrame } from '../../render/drawFrame';
import { loadRenderFonts } from '../../render/fonts';
import type { LayoutId } from '../../render/style';
import { createRiff } from '../../storage/riffs';
import { prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared } from '../../workers/protocol';
import { usePreview } from '../studio/usePreview';

/** Practice page (phase 6): a riff shared as a link — play it slower, loop it, save it. */
export function PracticeScreen({ data }: { data: string }) {
  const [payload, setPayload] = useState<PracticePayload | null | undefined>(undefined);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loop, setLoop] = useState(true);
  const [layout, setLayout] = useState<LayoutId>('classic');
  const [fontReady, setFontReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => void decodePractice(data).then(setPayload), [data]);
  useEffect(() => void loadRenderFonts().then(() => setFontReady(true)), []);
  useEffect(() => {
    if (!payload) return;
    prepareRiff({
      riff: { source: { kind: 'alphatex', text: payload.alphaTex }, trackIndex: 0, leadInMs: 1000, title: payload.title },
      soundFontUrl: DEFAULT_SOUND_PACK.url,
      soundMode: 'synth',
      tone: tonePreset('clean'),
    }).then(setPrepared, (e: unknown) => setError(e instanceof WorkerError ? e.message : String(e)));
  }, [payload]);

  const fps = 30;
  const pv = usePreview(prepared, fps, 0, null, loop);
  const settings = useMemo(() => defaultFrameSettings(fps, { view: '2d', layout }), [layout]);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && prepared) drawFrame(ctx, prepared.timeline, pv.frame, settings);
  }, [prepared, pv.frame, settings, fontReady]);

  if (payload === undefined) return <main className="screen no-nav"><p className="dim">Opening…</p></main>;
  if (payload === null) {
    return (
      <main className="screen no-nav" data-testid="practice-bad">
        <div className="topbar"><h1>Practice link</h1></div>
        <div className="errors" role="alert">This practice link is damaged or incomplete. Ask for it again.</div>
        <button className="btn" onClick={() => navigate({ name: 'library' })}>Open RiffReel</button>
      </main>
    );
  }
  return (
    <main className="screen no-nav studio" data-testid="practice">
      <div className="topbar">
        <button className="icon-btn" aria-label="Library" onClick={() => navigate({ name: 'library' })}>‹</button>
        <h1>{payload.title}</h1>
      </div>
      <p className="dim small">{payload.artist ? `${payload.artist} · ` : ''}Practice at your own speed — slow it down, loop it, save it.</p>
      {error && <div className="errors" role="alert">{error}</div>}
      <div className="preview-wrap">
        <canvas ref={canvasRef} width={settings.width} height={settings.height} aria-label="Riff" data-testid="practice-canvas" />
      </div>
      <div className="transport">
        <button className="icon-btn" aria-label={pv.playing ? 'Pause' : 'Play'} onClick={pv.playing ? pv.stop : pv.play} disabled={!prepared} data-testid="practice-play">
          {pv.playing ? '⏸' : '▶︎'}
        </button>
        <input type="range" min={0} max={pv.frames - 1} value={pv.frame} onChange={(e) => pv.seek(Number(e.target.value))} aria-label="Scrub" />
        <span className="time">{formatDuration(frameToMs(pv.frame, fps))}</span>
      </div>
      <Segmented<number> label="Speed" value={pv.speed} onChange={(v) => { pv.stop(); pv.setSpeed(v); }} options={[{ value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }]} />
      <Segmented<LayoutId> label="View" value={layout} onChange={setLayout} options={[{ value: 'classic', label: 'Whole neck' }, { value: 'closeup', label: 'Close-up' }]} />
      <label className="switch"><span>Loop</span><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /></label>
      <button
        className="btn primary block"
        data-testid="practice-save"
        onClick={async () => {
          const id = await createRiff({ title: payload.title, artist: payload.artist, isOriginal: false, source: 'alphatex', sourceText: payload.alphaTex, trackIndex: 0 });
          navigate({ name: 'review', riffId: id });
        }}
      >
        Save to my library
      </button>
    </main>
  );
}
