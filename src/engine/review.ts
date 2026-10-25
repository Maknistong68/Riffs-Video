/** Riff Review helpers (pure): what to show once per score note, and what to flag. */
import { optimizeFingering } from './fingering';
import type { RiffEdit } from './edits';
import { LOW_CONFIDENCE, MAX_FRET, validateTimeline, type NoteEvent, type NoteRef, type Timeline } from './timeline';

export type ReviewNote = NoteEvent & { ref: NoteRef; barStartMs: number; barEndMs: number };
export type ReviewBar = { index: number; startMs: number; endMs: number; notes: ReviewNote[] };
export type Flag = { level: 'error' | 'warn'; message: string };

/** Fret distance (max − min) above which a chord shape is flagged. */
export const WIDE_SPAN = 4;
export const UNREACHABLE_SPAN = 8;

export const refKey = (r: NoteRef) => `${r.bar}.${r.voice}.${r.beat}.${r.note}`;

/** Each score bar once (its first play), with the notes it contains. */
export function reviewBars(t: Timeline): ReviewBar[] {
  const lastEnd = Math.max(t.leadInMs, ...t.events.map((e) => e.startMs + e.durationMs));
  const firstPlay = new Map<number, { startMs: number; endMs: number }>();
  t.bars.forEach((b, i) => {
    if (!firstPlay.has(b.index)) firstPlay.set(b.index, { startMs: b.startMs, endMs: t.bars[i + 1]?.startMs ?? lastEnd });
  });
  const seen = new Set<string>();
  const bars = new Map<number, ReviewBar>();
  for (const [index, span] of [...firstPlay.entries()].sort((a, b) => a[0] - b[0])) bars.set(index, { index, ...span, notes: [] });
  for (const e of t.events) {
    if (!e.ref) continue;
    const key = refKey(e.ref);
    const bar = bars.get(e.ref.bar);
    if (seen.has(key) || !bar || e.startMs < bar.startMs || e.startMs >= bar.endMs + 0.5) continue;
    seen.add(key);
    bar.notes.push({ ...e, ref: e.ref, barStartMs: bar.startMs, barEndMs: bar.endMs });
  }
  return [...bars.values()];
}

/** Flags per note key: impossible (red) or low-confidence (amber). */
export function noteFlags(t: Timeline): Map<string, Flag[]> {
  const out = new Map<string, Flag[]>();
  const add = (e: NoteEvent, f: Flag) => {
    if (!e.ref) return;
    const k = refKey(e.ref);
    out.set(k, [...(out.get(k) ?? []), f]);
  };
  const byId = new Map(t.events.map((e) => [e.id, e]));
  for (const issue of validateTimeline(t)) {
    const e = issue.eventId ? byId.get(issue.eventId) : undefined;
    if (e) add(e, { level: 'error', message: issue.message });
  }
  // Chord stretches: very wide is a warning (it is playable for some hands); beyond any hand is an error.
  const chords = new Map<string, NoteEvent[]>();
  for (const e of t.events) if (e.chordId) chords.set(e.chordId, [...(chords.get(e.chordId) ?? []), e]);
  for (const notes of chords.values()) {
    const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
    const span = fretted.length > 1 ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const f: Flag | null =
      span > UNREACHABLE_SPAN ? { level: 'error', message: `Chord spans ${span + 1} frets: no hand can reach that` }
      : span > WIDE_SPAN ? { level: 'warn', message: `Very wide stretch (${span + 1} frets)` }
      : null;
    if (f) for (const n of notes) add(n, f);
  }
  for (const e of t.events) {
    if (e.fret > MAX_FRET) add(e, { level: 'error', message: `Fret above ${MAX_FRET}` });
    if (e.confidence !== undefined && e.confidence < LOW_CONFIDENCE) {
      add(e, { level: 'warn', message: `Low confidence (${Math.round(e.confidence * 100)}%)` });
    }
  }
  // Dedupe identical messages from repeats.
  for (const [k, fl] of out) out.set(k, fl.filter((f, i) => fl.findIndex((g) => g.message === f.message) === i));
  return out;
}

/** Position edits that would apply the optimizer's fingering (first play of each note only). */
export function fingeringEdits(t: Timeline): RiffEdit[] {
  const best = optimizeFingering(t);
  const edits: RiffEdit[] = [];
  const done = new Set<string>();
  t.events.forEach((e, i) => {
    const p = best[i];
    if (!e.ref || !p || done.has(refKey(e.ref))) return;
    done.add(refKey(e.ref));
    if (p.stringIdx !== e.stringIdx || p.fret !== e.fret) edits.push({ kind: 'position', ref: e.ref, stringIdx: p.stringIdx, fret: p.fret });
  });
  return edits;
}
