import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../../app/haptics';
import { navigate } from '../../app/router';
import { DEFAULT_SOUND_PACK } from '../../audio/soundpacks';
import { programOf } from '../../audio/tone';
import { Sheet } from '../../components/Sheet';
import type { RiffEdit } from '../../engine/edits';
import { fingeringEdits, noteFlags, refKey, reviewBars, type ReviewNote } from '../../engine/review';
import { frameToMs } from '../../engine/time';
import { db, styleOf, toneOf, type RiffRecord } from '../../storage/db';
import { readBlob } from '../../storage/opfs';
import { riffSource, updateRiff } from '../../storage/riffs';
import { prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared } from '../../workers/protocol';
import { usePreview } from '../studio/usePreview';
import { NoteEditor } from './NoteEditor';
import { TapRhythm } from './TapRhythm';
import { parseAsciiTab, spacingRhythm } from '../../import/asciiTab';
import { asciiToAlphaTex } from '../../import/asciiToAlphaTex';
import { handOffToAi, handOffToPaste } from '../../import/pasteHandoff';

const PX_PER_MS = 0.16;
const ROW = 30;

/** S4: accuracy gate — check every note, fix it, then confirm. */
export function ReviewScreen({ riffId }: { riffId: string }) {
  const riff = useLiveQuery(() => db().riffs.get(riffId), [riffId]);
  if (riff === undefined) return <main className="screen no-nav"><p className="dim">Loading…</p></main>;
  return <Review riff={riff} />;
}

function Review({ riff }: { riff: RiffRecord }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fingering, setFingering] = useState<RiffEdit[] | null>(null);
  const [tapping, setTapping] = useState(false);
  const ascii = useMemo(() => {
    if (!riff.asciiText) return null;
    try {
      return parseAsciiTab(riff.asciiText);
    } catch {
      return null;
    }
  }, [riff.asciiText]);
  const rhythmGuessed = riff.source === 'ascii' && riff.rhythm?.method === 'spacing';
  const aiFailed = riff.source === 'ai' && riff.ai?.status === 'failed';

  /** New rhythm → regenerate the alphaTex from the pasted tab (note refs change, so edits reset). */
  const applyRhythm = async (r: { units: number[] | null; bpm: number; method: 'taps' | 'tempo' }) => {
    if (!ascii) return;
    const units = r.units ?? riff.rhythm?.units ?? spacingRhythm(ascii.columns);
    const { text } = asciiToAlphaTex(ascii, { title: riff.title, bpm: r.bpm, units });
    await updateRiff(riff.id, { sourceText: text, rhythm: { method: r.method, bpm: r.bpm, units }, edits: [], timelineCache: undefined });
    setTapping(false);
  };
  const edits = riff.edits ?? [];
  const source = useMemo(() => riffSource(riff), [riff.sourceText, riff.sourceBytes, riff.fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = styleOf(riff);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    prepareRiff({
      riff: { source, trackIndex: riff.trackIndex, leadInMs: style.leadInMs, title: riff.title, program: programOf(toneOf(style).instrument), ...(riff.noteConfidence ? { noteConfidence: riff.noteConfidence } : {}), edits },
      soundFontUrl: DEFAULT_SOUND_PACK.url,
      soundMode: 'synth',
      tone: toneOf(style),
    }).then(
      (p) => live && (setPrepared(p), setError(null)),
      (e: unknown) => live && setError(e instanceof WorkerError ? [e.message, ...e.details] : [String(e)]),
    );
    return () => {
      live = false;
    };
  }, [source, riff.trackIndex, JSON.stringify(edits)]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = prepared?.timeline;
  const bars = useMemo(() => (t ? reviewBars(t) : []), [t]);
  const flags = useMemo(() => (t ? noteFlags(t) : new Map()), [t]);
  const errorCount = [...flags.values()].filter((f) => f.some((x: { level: string }) => x.level === 'error')).length;
  const warnCount = [...flags.values()].filter((f) => f.every((x: { level: string }) => x.level === 'warn')).length;
  const noteCount = bars.reduce((n, b) => n + b.notes.length, 0);
  const pv = usePreview(prepared, 60);
  const nowMs = frameToMs(pv.frame, 60);
  // Every note sounding now (all notes of a chord), not just the first one found.
  const playingKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!t || !pv.playing) return keys;
    for (const x of t.events) if (x.ref && nowMs >= x.startMs && nowMs < x.startMs + x.durationMs) keys.add(refKey(x.ref));
    return keys;
  }, [t, nowMs, pv.playing]);
  const playingKey = playingKeys.values().next().value ?? null;

  // Keep the playing bar in view.
  useEffect(() => {
    if (!playingKey) return;
    scroller.current?.querySelector(`[data-key="${playingKey}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [playingKey]);

  const addEdit = (e: RiffEdit) => {
    haptic();
    void updateRiff(riff.id, { edits: [...edits, e], timelineCache: undefined });
  };
  const selectedNote: ReviewNote | undefined = bars.flatMap((b) => b.notes).find((n) => refKey(n.ref) === selected);
  const strings = t?.tuning.length ?? 6;

  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back to library" onClick={() => navigate({ name: 'library' })}>‹</button>
        <h1>Review notes</h1>
        <button className="icon-btn" aria-label={pv.playing ? 'Pause' : 'Play'} onClick={pv.playing ? pv.stop : pv.play} disabled={!prepared}>
          {pv.playing ? '⏸' : '▶︎'}
        </button>
      </div>
      <p className="dim small">
        {riff.title} — tap any note to fix string, fret, rhythm or technique. Changes are re-synthesised, so the sound always
        matches the tab.
      </p>

      {error && !aiFailed && <div className="errors" role="alert">{error.map((m, i) => <span key={i}>{m}</span>)}</div>}
      {riff.source === 'ai' && riff.ai && (aiFailed ? (
        <div className="errors" role="alert" data-testid="ai-failed">
          <strong>{riff.ai.generated ? 'The AI riff didn’t work' : 'AI import didn’t work'}</strong>
          <span>{riff.ai.message ?? 'The AI answer could not be used.'}</span>
          {(riff.ai.errors ?? []).slice(0, 5).map((m, i) => <span key={i} className="small">{m}</span>)}
          <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
            {riff.sourceText ? <button className="btn" onClick={() => navigate({ name: 'write', riffId: riff.id })} data-testid="ai-edit-tex">Fix the tab by hand</button> : null}
            {riff.ai.generated ? (
              <button className="btn" onClick={() => navigate({ name: 'generate' })} data-testid="ai-retry">Generate another</button>
            ) : (
              <>
                <button className="btn" onClick={() => { handOffToPaste(riff.ai!.originalText); navigate({ name: 'paste' }); }} data-testid="ai-as-paste">Paste as text tab</button>
                <button className="btn" onClick={() => { handOffToAi(riff.ai!.originalText); navigate({ name: 'ai' }); }} data-testid="ai-retry">Try AI again</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={riff.ai.rhythmGuessed || warnCount > 0 ? 'notice' : 'card'} data-testid="ai-banner">
          <span>
            {riff.ai.generated ? 'An original riff written by AI — play it before you style it.' : 'Written out by AI from your text.'}{' '}
            {warnCount > 0 ? `${warnCount} note${warnCount === 1 ? '' : 's'} marked amber need a look. ` : ''}
            {riff.ai.rhythmGuessed ? 'The rhythm was guessed — play it and fix note lengths in the editor. ' : ''}
            {riff.ai.tempoGuessed ? `Tempo guessed (${t?.tempoMap[0] ? Math.round(t.tempoMap[0].bpm) : '?'} bpm). ` : ''}
          </span>
          {riff.ai.warnings.length > 0 && (
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {riff.ai.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            {riff.ai.generated ? (
              <button className="btn ghost small" onClick={() => navigate({ name: 'generate' })}>Not your style? Generate another</button>
            ) : (
              <button className="btn ghost small" onClick={() => { handOffToPaste(riff.ai!.originalText); navigate({ name: 'paste' }); }}>Not right? Paste as text tab</button>
            )}
          </div>
        </div>
      ))}
      {riff.source === 'audio' && (
        <div className="card" data-testid="audio-banner">
          <span>
            Written from your recording at {riff.rhythm?.bpm ?? '?'} bpm.{' '}
            {warnCount > 0 ? `${warnCount} note${warnCount === 1 ? '' : 's'} marked amber need a look.` : 'All notes heard clearly.'}
          </span>
          {riff.recordingPath && <OriginalPlayer path={riff.recordingPath} />}
        </div>
      )}
      {riff.source === 'ascii' && ascii && (
        <div className={rhythmGuessed ? 'notice' : 'card'} data-testid="rhythm-banner">
          <span>
            {rhythmGuessed
              ? `Rhythm missing: guessed from the tab’s spacing at ${riff.rhythm?.bpm ?? 100} bpm. Tap it for the real thing.`
              : `Rhythm from your ${riff.rhythm?.method === 'taps' ? 'taps' : 'tempo tap'} · ${riff.rhythm?.bpm} bpm`}
          </span>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" data-testid="open-tap" onClick={() => setTapping(true)}>{rhythmGuessed ? 'Tap the rhythm' : 'Tap again'}</button>
          </div>
          {edits.length > 0 && <p className="small dim">Changing the rhythm resets your {edits.length} note edit{edits.length === 1 ? '' : 's'}.</p>}
        </div>
      )}
      {prepared && prepared.editErrors.length > 0 && (
        <div className="errors">{prepared.editErrors.map((m, i) => <span key={i}>Edit skipped: {m}</span>)}</div>
      )}

      {!aiFailed && (<>
      <div className="card row spread" data-testid="review-summary">
        <span><strong>{noteCount}</strong> note{noteCount === 1 ? '' : 's'} · {bars.length} bar{bars.length === 1 ? '' : 's'}</span>
        <span>
          {errorCount > 0 ? <span className="bad">● {errorCount} impossible</span> : <span className="good">✓ all playable</span>}
          {warnCount > 0 && <span className="warn"> · ● {warnCount} unsure</span>}
          {rhythmGuessed && <span className="warn"> · rhythm missing</span>}
        </span>
      </div>

      <div ref={scroller} className="tabview" aria-label="Tab" style={{ height: ROW * (strings - 1) + 64 }}>
        {t &&
          bars.map((bar) => {
            const width = Math.max(140, (bar.endMs - bar.startMs) * PX_PER_MS + 40);
            return (
              <div key={bar.index} className="tabbar" style={{ width }}>
                <span className="barno">{bar.index + 1}</span>
                {Array.from({ length: strings }, (_, s) => (
                  <div key={s} className="tabline" style={{ top: 32 + s * ROW }} />
                ))}
                {bar.notes.map((n) => {
                  const key = refKey(n.ref);
                  const f = flags.get(key);
                  const cls = f?.some((x: { level: string }) => x.level === 'error') ? 'bad' : f ? 'warn' : '';
                  return (
                    <button
                      key={key}
                      data-key={key}
                      className={`tabnote ${cls} ${selected === key ? 'sel' : ''} ${playingKeys.has(key) ? 'playing' : ''}`}
                      style={{ left: 20 + (n.startMs - bar.startMs) * PX_PER_MS, top: 32 + n.stringIdx * ROW }}
                      onClick={() => setSelected(key)}
                      aria-label={`Bar ${bar.index + 1}, string ${n.stringIdx + 1}, fret ${n.fret}`}
                    >
                      {n.tech.includes('dead') ? 'x' : n.fret}
                      {n.tech.length > 0 && <sup>{glyph(n)}</sup>}
                    </button>
                  );
                })}
              </div>
            );
          })}
      </div>

      <div className="row">
        <button className="btn" style={{ flex: 1 }} disabled={!t} onClick={() => t && setFingering(fingeringEdits(t))}>Better fingering</button>
        <button className="btn" style={{ flex: 1 }} disabled={edits.length === 0} onClick={() => void updateRiff(riff.id, { edits: edits.slice(0, -1), timelineCache: undefined })}>
          Undo
        </button>
      </div>
      </>)}
      {edits.length > 0 && (
        <button className="btn ghost small" onClick={() => void updateRiff(riff.id, { edits: [], timelineCache: undefined })}>
          Reset {edits.length} edit{edits.length === 1 ? '' : 's'}
        </button>
      )}

      <div style={{ flex: 1 }} />
      <button
        className="btn primary block"
        data-testid="confirm-review"
        disabled={!t || errorCount > 0}
        onClick={async () => {
          await updateRiff(riff.id, { reviewed: true });
          navigate({ name: 'studio', riffId: riff.id }, true);
        }}
      >
        {aiFailed ? 'Fix the tab first' : errorCount > 0 ? `Fix ${errorCount} impossible note${errorCount === 1 ? '' : 's'} first` : 'Looks right — open Studio'}
      </button>

      {selectedNote && t && (
        <NoteEditor key={selected + JSON.stringify(edits.length)} note={selectedNote} timeline={t} flags={flags.get(selected!) ?? []} onEdit={addEdit} onClose={() => setSelected(null)} />
      )}
      {tapping && ascii && (
        <TapRhythm columns={ascii.columns} bpm={riff.rhythm?.bpm ?? 100} onApply={(r) => void applyRhythm(r)} onClose={() => setTapping(false)} />
      )}
      {fingering && (
        <Sheet label="Better fingering" onClose={() => setFingering(null)}>
          <h2>Better fingering</h2>
          {fingering.length === 0 ? (
            <p>The current fingering is already the most comfortable one we found.</p>
          ) : (
            <>
              <p>Move {fingering.length} note{fingering.length === 1 ? '' : 's'} so the hand stays in one position (same pitches, less movement).</p>
              <button className="btn primary block" onClick={() => { void updateRiff(riff.id, { edits: [...edits, ...fingering], timelineCache: undefined }); setFingering(null); }}>
                Apply
              </button>
            </>
          )}
          <button className="btn block" onClick={() => setFingering(null)}>Close</button>
        </Sheet>
      )}
    </main>
  );
}

function glyph(n: ReviewNote): string {
  if (n.tech.includes('hammer')) return 'h';
  if (n.tech.includes('pull')) return 'p';
  if (n.tech.includes('slide')) return '/';
  if (n.tech.includes('bend')) return 'b';
  if (n.tech.includes('vibrato')) return '~';
  if (n.tech.includes('palmMute')) return 'pm';
  if (n.tech.includes('harmonic')) return '◇';
  return '';
}

/** Play the original recording next to the synth (comparison only). */
function OriginalPlayer({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void readBlob(db(), path, '').then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [path]);
  return url ? <audio src={url} controls style={{ width: '100%', marginTop: 8 }} aria-label="Original recording" /> : null;
}
