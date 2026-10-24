import { expectedMidi, type NoteEvent, type Timeline } from '../../../src/engine/timeline';

/** Standard tuning in display order: high e, B, G, D, A, low E. */
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

const BPM = 100;
const EIGHTH_MS = 60_000 / BPM / 2; // 300 ms
const LEAD_IN_MS = 1000;
const TAIL_MS = 1000;

/** An original E-minor-pentatonic phrase (safe to post): [stringIdx, fret]. */
const PHRASE: [number, number][] = [
  [5, 0],
  [5, 3],
  [4, 0],
  [4, 2],
  [3, 0],
  [3, 2],
  [4, 2],
  [5, 3],
];

/** Phase 0 hard-coded 8-note timeline (one bar of eighths at 100 bpm after a 1 s lead-in). */
export function demoTimeline(): Timeline {
  const base = { tuning: STANDARD_TUNING, capo: 0 };
  const events: NoteEvent[] = PHRASE.map(([stringIdx, fret], i) => ({
    id: `n${i}`,
    startMs: LEAD_IN_MS + i * EIGHTH_MS,
    // Last note rings for a quarter, the others are slightly detached eighths.
    durationMs: i === PHRASE.length - 1 ? EIGHTH_MS * 2 : EIGHTH_MS * 0.9,
    stringIdx,
    fret,
    midi: expectedMidi(base, stringIdx, fret),
    tech: [],
  }));
  const barMs = EIGHTH_MS * 8;
  return {
    version: 1,
    title: 'Spike Riff in E minor',
    ...base,
    tempoMap: [{ ms: 0, bpm: BPM }],
    leadInMs: LEAD_IN_MS,
    durationMs: LEAD_IN_MS + barMs + TAIL_MS,
    events,
    bars: [{ index: 0, startMs: LEAD_IN_MS }],
  };
}
