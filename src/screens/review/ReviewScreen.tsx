import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../../app/haptics';
import { navigate } from '../../app/router';
import { DEFAULT_SOUND_PACK } from '../../audio/soundpacks';
import { Sheet } from '../../components/Sheet';
import type { RiffEdit } from '../../engine/edits';
import { fingeringEdits, noteFlags, refKey, reviewBars, type ReviewNote } from '../../engine/review';
import { frameToMs } from '../../engine/time';
import { db, styleOf, type RiffRecord } from '../../storage/db';
import { riffSource, updateRiff } from '../../storage/riffs';
import { prepareRiff, WorkerError } from '../../workers/client';
import type { Prepared } from '../../workers/protocol';
import { usePreview } from '../studio/usePreview';
import { NoteEditor } from './NoteEditor';

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
  const edits = riff.edits ?? [];
  const source = useMemo(() => riffSource(riff), [riff.sourceText, riff.sourceBytes, riff.fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = styleOf(riff);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    prepareRiff({
      riff: { source, trackIndex: riff.trackIndex, leadInMs: style.leadInMs, title: riff.title, edits },
      soundFontUrl: DEFAULT_SOUND_PACK.url,
      soundMode: 'synth',
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
  const playingKey = useMemo(() => {
    if (!t || !pv.playing) return null;
    const e = t.events.find((x) => x.ref && nowMs >= x.startMs && nowMs < x.startMs + x.durationMs);
    return e?.ref ? refKey(e.ref) : null;
  }, [t, nowMs, pv.playing]);

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

      {error && <div className="errors" role="alert">{error.map((m, i) => <span key={i}>{m}</span>)}</div>}
      {prepared && prepared.editErrors.length > 0 && (
        <div className="errors">{prepared.editErrors.map((m, i) => <span key={i}>Edit skipped: {m}</span>)}</div>
      )}

      <div className="card row spread" data-testid="review-summary">
        <span><strong>{noteCount}</strong> notes · {bars.length} bars</span>
        <span>
          {errorCount > 0 ? <span className="bad">● {errorCount} impossible</span> : <span className="good">✓ all playable</span>}
          {warnCount > 0 && <span className="warn"> · ● {warnCount} unsure</span>}
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
                      className={`tabnote ${cls} ${selected === key ? 'sel' : ''} ${playingKey === key ? 'playing' : ''}`}
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
        {errorCount > 0 ? `Fix ${errorCount} impossible note${errorCount === 1 ? '' : 's'} first` : 'Looks right — open Studio'}
      </button>

      {selectedNote && t && (
        <NoteEditor key={selected + JSON.stringify(edits.length)} note={selectedNote} timeline={t} flags={flags.get(selected!) ?? []} onEdit={addEdit} onClose={() => setSelected(null)} />
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
