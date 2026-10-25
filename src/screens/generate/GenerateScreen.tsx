import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../app/router';
import { Segmented } from '../../components/Segmented';
import { tonePreset } from '../../audio/tone';
import { GEN_GENRES, generateRiff, riffOfTheDay, type GenDifficulty, type GenGenre, type GenOptions } from '../../engine/generate';
import type { Timeline } from '../../engine/timeline';
import { tabPreview } from '../../engine/tabPreview';
import { aiConfig, generateRiffWithAI, isAnswerFailure, MAX_AI_IDEA_CHARS, type AiFailure } from '../../import/ai';
import { db, deviceId, DEFAULT_STYLE, getSettings, type StyleSettings } from '../../storage/db';
import { createRiff } from '../../storage/riffs';
import { buildRiffTimeline, checkAiTabInWorker } from '../../workers/client';
import { GENRES } from '../studio/genres';

type Writer = 'builtin' | 'ai';

/** The genre's look and sound (colours, tone, drums) as the new riff's starting style. */
async function genreStyle(genre: GenGenre): Promise<StyleSettings> {
  const g = GENRES.find((x) => x.id === genre);
  const s = await getSettings(db());
  const base = { ...DEFAULT_STYLE, fps: s.defaultFps };
  return g ? { ...base, render: { ...base.render, theme: g.theme }, tone: tonePreset(g.tone), drums: { pattern: g.drums, volume: 0.6 } } : base;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** S3: 🎲 Generate an original riff — built-in (offline, seeded) or written by AI from a brief. Always goes to Riff Review. */
export function GenerateScreen() {
  const [writer, setWriter] = useState<Writer>('builtin');
  const [opts, setOpts] = useState<GenOptions>(() => riffOfTheDay(new Date()));
  const [autoTempo, setAutoTempo] = useState(true);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const config = aiConfig();
  const today = useMemo(() => riffOfTheDay(new Date()), []);
  const isToday = opts.seed === today.seed && opts.genre === today.genre && opts.difficulty === today.difficulty && opts.bars === today.bars && autoTempo;

  const riff = useMemo(() => generateRiff(autoTempo ? { ...opts, bpm: undefined } : opts), [opts, autoTempo]);
  const [preview, setPreview] = useState<Timeline | undefined>(undefined);
  useEffect(() => {
    let live = true;
    buildRiffTimeline({ source: { kind: 'alphatex', text: riff.alphaTex }, trackIndex: 0, leadInMs: 0, title: riff.title }).then(
      (t) => live && setPreview(t),
      () => live && setPreview(undefined),
    );
    return () => {
      live = false;
    };
  }, [riff]);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const set = (patch: Partial<GenOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const saveBuiltin = async () => {
    setBusy(true);
    try {
      const id = await createRiff({
        title: isToday ? `Riff of the day · ${riff.title}` : riff.title,
        artist: 'RiffReel generator',
        isOriginal: true,
        source: 'alphatex',
        sourceText: riff.alphaTex,
        trackIndex: 0,
        styleSettings: await genreStyle(riff.genre),
      });
      navigate({ name: 'review', riffId: id }, true);
    } finally {
      setBusy(false);
    }
  };

  const writeWithAi = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await generateRiffWithAI({ genre: opts.genre, difficulty: opts.difficulty, bars: opts.bars, idea }, { config, deviceId: await deviceId(db()), online: navigator.onLine });
      if (!result.ok && !isAnswerFailure(result.code)) return setFailure(result);
      const base = { artist: 'AI riff', isOriginal: true, source: 'ai' as const, styleSettings: await genreStyle(opts.genre) };
      const meta = { originalText: idea, generated: true, rhythmGuessed: false, tempoGuessed: false };
      let id: string;
      if (result.ok) {
        // Same gate as AI import: alphaTab re-parses the answer and the timeline is validated.
        const check = await checkAiTabInWorker(result.alphaTex, result.notes).catch(() => null);
        id = await createRiff({
          ...base,
          title: result.title || `${opts.genre} riff`,
          sourceText: result.alphaTex,
          trackIndex: check?.trackIndex ?? 0,
          ai: {
            ...meta,
            status: check?.ok ? 'ok' : 'failed',
            ...(check?.ok ? {} : { message: 'The AI wrote a riff with mistakes the app can’t read. Fix it by hand, or generate another.' }),
            errors: check?.errors ?? ['The riff could not be checked.'],
            warnings: [...result.warnings, ...(check?.warnings ?? [])],
            model: result.model,
          },
        });
      } else {
        id = await createRiff({ ...base, title: `${opts.genre} riff`, sourceText: '', trackIndex: 0, ai: { ...meta, status: 'failed', message: result.message, warnings: [] } });
      }
      navigate({ name: 'review', riffId: id }, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen no-nav" data-testid="generate">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>Generate a riff</h1>
      </div>
      <p className="dim small">Original riffs only — made from scales and rhythms, never copied from a song, so they’re safe to post and monetize.</p>

      <Segmented<Writer> label="Writer" value={writer} onChange={setWriter} options={[{ value: 'builtin', label: 'Built-in (offline)' }, { value: 'ai', label: 'AI (Claude)' }]} />

      <div className="field">
        <span>Style</span>
        <div className="chips" role="group" aria-label="Style" style={{ flexWrap: 'wrap' }}>
          {GEN_GENRES.map((g) => (
            <button key={g.id} className={`chip ${opts.genre === g.id ? 'on' : ''}`} aria-pressed={opts.genre === g.id} onClick={() => set({ genre: g.id })} disabled={busy}>
              {g.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Difficulty</span>
        <Segmented<GenDifficulty> label="Difficulty" value={opts.difficulty} onChange={(d) => set({ difficulty: d })} disabled={busy} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
      </div>
      <div className="field">
        <span>Length</span>
        <Segmented<2 | 4> label="Length" value={opts.bars} onChange={(b) => set({ bars: b })} disabled={busy} options={[{ value: 2, label: '2 bars' }, { value: 4, label: '4 bars' }]} />
      </div>

      {writer === 'builtin' ? (
        <>
          <div className="field">
            <span>Tempo{autoTempo ? ' (picked for the style)' : `: ${opts.bpm ?? riff.bpm} bpm`}</span>
            <div className="row" style={{ gap: 8 }}>
              <label className="switch" style={{ flex: '0 0 auto' }}>
                <span>Auto</span>
                <input type="checkbox" checked={autoTempo} onChange={(e) => { setAutoTempo(e.target.checked); if (!e.target.checked) set({ bpm: riff.bpm }); }} data-testid="gen-auto-tempo" />
              </label>
              {!autoTempo && (
                <input type="range" min={60} max={180} step={2} value={opts.bpm ?? riff.bpm} onChange={(e) => set({ bpm: Number(e.target.value) })} aria-label="Tempo" style={{ flex: 1 }} />
              )}
            </div>
          </div>

          <div className="card" data-testid="gen-preview">
            <div className="row spread">
              <strong data-testid="gen-title">{isToday ? '🌅 Riff of the day' : '🎲 Your riff'}</strong>
              <span className="dim small">{riff.key} {riff.scale} · {riff.bpm} bpm{riff.tuning[riff.tuning.length - 1] === 38 ? ' · drop D' : ''}</span>
            </div>
            <pre className="tab-preview" data-testid="gen-tab" aria-label="Tab preview">{preview ? tabPreview(preview) : ' \n \n \n \n \n '}</pre>
            <span className="dim small">{riff.title}</span>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setOpts({ ...opts, seed: randomSeed() })} disabled={busy} data-testid="gen-shuffle">🎲 Shuffle</button>
            <button className="btn" onClick={() => { setOpts(today); setAutoTempo(true); }} disabled={busy || isToday} data-testid="gen-today">🌅 Riff of the day</button>
          </div>
          <button className="btn primary block" onClick={() => void saveBuiltin()} disabled={busy} data-testid="gen-use">
            {busy ? 'Saving…' : 'Use this riff →'}
          </button>
        </>
      ) : (
        <>
          {!config && <div className="notice" data-testid="gen-ai-off">AI riffs aren’t set up in this version of the app. The built-in generator works offline.</div>}
          {config && !online && <div className="notice">You’re offline. AI riffs need internet — the built-in generator works offline.</div>}
          <label className="field">
            <span>Idea (optional)</span>
            <textarea className="input" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. surf-rock vibe, lots of open strings, ends with a bend" maxLength={MAX_AI_IDEA_CHARS} style={{ minHeight: 90 }} disabled={busy} data-testid="gen-idea" />
          </label>
          <p className="dim small">Your choices and idea are sent to Claude (Anthropic) through RiffReel’s server. Song names won’t be copied — you’ll get something new in that style.</p>
          {failure && <div className="errors" role="alert" data-testid="gen-ai-error">{failure.message}</div>}
          <button className="btn primary block" onClick={() => void writeWithAi()} disabled={busy || !config || !online} data-testid="gen-ai-go">
            {busy ? 'Writing your riff…' : 'Write it with AI →'}
          </button>
        </>
      )}
    </main>
  );
}
