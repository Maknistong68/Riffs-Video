/** Timeline: the single source of truth for audio, visuals and verification (see CLAUDE.md §3). */

export type Technique =
  | 'bend'
  | 'release'
  | 'slide'
  | 'hammer'
  | 'pull'
  | 'palmMute'
  | 'vibrato'
  | 'harmonic'
  | 'dead'
  | 'tieContinue';

export type NoteEvent = {
  id: string;
  /** Relative to start of video (includes leadInMs). */
  startMs: number;
  durationMs: number;
  /** 0 = high e … 5 = low E (display order). */
  stringIdx: number;
  /** 0 = open. */
  fret: number;
  /** Must equal tuning[stringIdx] + capo + fret. */
  midi: number;
  finger?: 1 | 2 | 3 | 4 | 'T';
  pick?: 'down' | 'up';
  tech: Technique[];
  chordId?: string;
  /** Sounds without a new pick attack (slide destination): no onset is expected in the audio. */
  legato?: boolean;
  /** Bend target above `midi` in semitones (bend/release techniques). */
  bendSemitones?: number;
  /** 0..1; < LOW_CONFIDENCE is flagged in the UI. */
  confidence?: number;
};

export type Timeline = {
  version: 1;
  title: string;
  /** MIDI pitch per string, index 0 = HIGH e (tab-display order). */
  tuning: number[];
  capo: number;
  tempoMap: { ms: number; bpm: number }[];
  /** Count-in, applied in ONE place only (buildTimeline). */
  leadInMs: number;
  durationMs: number;
  /** Sorted by startMs, repeats already expanded. */
  events: NoteEvent[];
  bars: { index: number; startMs: number }[];
};

export const MAX_FRET = 24;
export const LOW_CONFIDENCE = 0.7;

export type TimelineIssue = { eventId?: string; message: string };

/** Structural + musical validation. Returns [] when the timeline is safe to render. */
export function validateTimeline(t: Timeline): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const err = (message: string, eventId?: string) =>
    issues.push(eventId === undefined ? { message } : { eventId, message });

  if (t.version !== 1) err(`Unsupported timeline version ${String(t.version)}`);
  if (t.tuning.length < 4 || t.tuning.length > 8) err(`Tuning must have 4–8 strings, got ${t.tuning.length}`);
  if (!Number.isInteger(t.capo) || t.capo < 0 || t.capo > MAX_FRET) err(`Capo out of range: ${t.capo}`);
  if (t.tempoMap.length === 0) err('Tempo map is empty');
  for (let i = 1; i < t.tempoMap.length; i++) {
    if (t.tempoMap[i]!.ms < t.tempoMap[i - 1]!.ms) err('Tempo map is not sorted');
  }
  if (t.leadInMs < 0) err('leadInMs must be ≥ 0');
  if (!(t.durationMs > 0)) err('durationMs must be > 0');
  for (let i = 1; i < t.bars.length; i++) {
    if (t.bars[i]!.startMs < t.bars[i - 1]!.startMs) err('Bars are not sorted');
  }

  const ids = new Set<string>();
  let prevStart = -Infinity;
  for (const e of t.events) {
    if (ids.has(e.id)) err(`Duplicate event id`, e.id);
    ids.add(e.id);
    if (e.startMs < prevStart) err('Events are not sorted by startMs', e.id);
    prevStart = e.startMs;
    if (e.startMs < t.leadInMs) err(`Note starts inside the lead-in (${e.startMs} ms)`, e.id);
    if (!(e.durationMs > 0)) err('Note duration must be > 0', e.id);
    if (e.startMs + e.durationMs > t.durationMs) err('Note ends after the timeline', e.id);
    if (!Number.isInteger(e.stringIdx) || e.stringIdx < 0 || e.stringIdx >= t.tuning.length) {
      err(`String ${e.stringIdx} does not exist on a ${t.tuning.length}-string guitar`, e.id);
      continue;
    }
    if (!Number.isInteger(e.fret) || e.fret < 0 || e.fret > MAX_FRET) err(`Fret ${e.fret} out of range 0–${MAX_FRET}`, e.id);
    const expected = expectedMidi(t, e.stringIdx, e.fret);
    if (e.midi !== expected) err(`Pitch mismatch: midi ${e.midi} but string/fret gives ${expected}`, e.id);
    if (e.confidence !== undefined && !(e.confidence >= 0 && e.confidence <= 1)) err('Confidence must be 0..1', e.id);
  }
  return issues;
}

export function expectedMidi(t: Pick<Timeline, 'tuning' | 'capo'>, stringIdx: number, fret: number): number {
  return (t.tuning[stringIdx] ?? NaN) + t.capo + fret;
}

/** Index of the first event with startMs > ms (binary search). */
export function upperBound(events: readonly NoteEvent[], ms: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.startMs <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The most recent note struck on each string at time `ms` (null if none yet).
 * A string sounds one note at a time, so a newer note on the same string replaces the older one.
 */
export function lastNotePerString(t: Timeline, ms: number): (NoteEvent | null)[] {
  const out: (NoteEvent | null)[] = t.tuning.map(() => null);
  let missing = out.length;
  for (let i = upperBound(t.events, ms) - 1; i >= 0 && missing > 0; i--) {
    const e = t.events[i]!;
    if (out[e.stringIdx] === null) {
      out[e.stringIdx] = e;
      missing--;
    }
  }
  return out;
}

/** Notes sounding at `ms` (startMs ≤ ms < startMs + durationMs), one per string at most. */
export function activeEvents(t: Timeline, ms: number): NoteEvent[] {
  return lastNotePerString(t, ms).filter(
    (e): e is NoteEvent => e !== null && ms < e.startMs + e.durationMs,
  );
}
