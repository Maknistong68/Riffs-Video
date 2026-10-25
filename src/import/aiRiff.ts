/**
 * Check an AI-written alphaTex before it becomes a riff (CLAUDE.md §6, P19): re-parse it with
 * alphaTab, build and validate the timeline, and attach the model's per-note confidence to the
 * notes it describes. Runs in the worker (alphaTab). Never throws: problems are returned.
 */
import { buildTimeline, DEFAULT_BUILD } from '../engine/buildTimeline';
import { refKey } from '../engine/review';
import { validateTimeline } from '../engine/timeline';
import { loadAlphaTex, playableTracks, ScoreImportError } from './alphatab';

export type AiNote = { bar: number; beat: number; string: number; fret: number; confidence: number };

export type AiTabCheck = {
  ok: boolean;
  /** Why the tab can't be used as-is (parse errors, no guitar track, broken timeline). */
  errors: string[];
  /** Things the user should know but that don't block Review. */
  warnings: string[];
  trackIndex: number;
  noteCount: number;
  /** Confidence by note ref key; notes the model didn't rate are marked unsure. */
  noteConfidence: Record<string, number>;
};

/** Confidence for a note the model wrote but did not rate: shown amber (< 0.7) so it gets a look. */
export const UNRATED_CONFIDENCE = 0.6;

export function checkAiTab(alphaTex: string, notes: readonly AiNote[]): AiTabCheck {
  const empty = (errors: string[]): AiTabCheck => ({ ok: false, errors, warnings: [], trackIndex: 0, noteCount: 0, noteConfidence: {} });
  let score;
  try {
    score = loadAlphaTex(alphaTex);
  } catch (e) {
    const details = e instanceof ScoreImportError ? e.details : [e instanceof Error ? e.message : String(e)];
    return empty(details.length ? details.slice(0, 8) : ['The tab could not be read.']);
  }
  const track = playableTracks(score)[0];
  if (!track) return empty(['There is no guitar or bass tab in the converted riff.']);

  let timeline;
  try {
    timeline = buildTimeline(score, { ...DEFAULT_BUILD, trackIndex: track.index }).timeline;
  } catch (e) {
    return empty([e instanceof Error ? e.message : String(e)]);
  }
  if (timeline.events.length === 0) return empty(['The converted riff has no notes.']);
  // Impossible notes (string/fret out of range) are shown red in Review; structural problems block it.
  const structural = validateTimeline(timeline).filter((i) => i.eventId === undefined);
  if (structural.length) return { ...empty(structural.map((i) => i.message)), trackIndex: track.index };

  // Each score note once (repeats play it again with the same ref).
  const byRef = new Map<string, { bar: number; beat: number; string: number; fret: number }>();
  for (const e of timeline.events) {
    if (!e.ref || e.ref.voice !== 0) continue;
    byRef.set(refKey(e.ref), { bar: e.ref.bar, beat: e.ref.beat, string: e.stringIdx + 1, fret: e.fret });
  }
  const exact = new Map<string, number>();
  const loose = new Map<string, number[]>();
  for (const n of notes) {
    exact.set(`${n.bar}|${n.beat}|${n.string}|${n.fret}`, n.confidence);
    const k = `${n.bar}|${n.string}|${n.fret}`;
    loose.set(k, [...(loose.get(k) ?? []), n.confidence]);
  }
  const noteConfidence: Record<string, number> = {};
  let unrated = 0;
  for (const [key, n] of byRef) {
    let c = exact.get(`${n.bar}|${n.beat}|${n.string}|${n.fret}`);
    if (c === undefined) {
      // Beat counted differently by the model: accept a unique match on bar + string + fret.
      const l = loose.get(`${n.bar}|${n.string}|${n.fret}`);
      if (l?.length === 1) c = l[0];
    }
    if (c === undefined) {
      unrated++;
      c = UNRATED_CONFIDENCE;
    }
    noteConfidence[key] = Math.max(0, Math.min(1, c));
  }
  const warnings: string[] = [];
  if (unrated > 0) warnings.push(`${unrated} of ${byRef.size} notes came without a confidence from the AI; they are marked unsure.`);
  return { ok: true, errors: [], warnings, trackIndex: track.index, noteCount: byRef.size, noteConfidence };
}
