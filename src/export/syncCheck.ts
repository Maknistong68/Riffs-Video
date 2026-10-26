/**
 * Pure Sync Report matching (CLAUDE.md §3): timeline notes vs what was heard in the exported audio.
 * - pitch: Basic Pitch note with the expected MIDI pitch (±50 cents = same semitone) near the onset;
 *   bends accept the bent range; octave confusions are accepted but flagged.
 * - timing: nearest spectral-flux onset must be within ±1 video frame.
 */
import type { DetectedNote } from '../audio/transcribe';
import type { NoteEvent, Timeline } from '../engine/timeline';

/** Basic Pitch's own onset resolution is ~11.6 ms frames with smearing; used for pitch pairing only. */
export const PITCH_SEARCH_MS = 70;
const HARMONIC_OFFSETS = [12, 19, 24, 28, 31];
/** Faint detections (synth resonances, Basic Pitch ghosts) are not worth reporting. */
export const EXTRA_MIN_AMPLITUDE = 0.4;

export type CheckKind = 'full' | 'onset-only' | 'skipped';

export type NoteMatch = {
  eventId: string;
  expectedMs: number;
  expectedMidi: number;
  kind: CheckKind;
  onsetMs: number | null;
  errorMs: number | null;
  onsetOk: boolean;
  detectedMidi: number | null;
  pitchOk: boolean;
  ok: boolean;
  detail: string;
  /** Verified on the guitar before effects (the processed sound masked the attack). */
  viaDry?: boolean;
};

export type FrameCheck = { frame: number; psnr: number; ok: boolean };
export type HighlightCheck = { eventId: string; frame: number; ok: boolean; detail: string };

export type SyncReport = {
  ok: boolean;
  fps: number;
  toleranceMs: number;
  matched: number;
  total: number;
  maxAbsErrorMs: number;
  matches: NoteMatch[];
  extras: DetectedNote[];
  durations: { videoSec: number; audioSec: number; diffMs: number; ok: boolean } | null;
  frames: FrameCheck[];
  highlights: HighlightCheck[];
  audioLatencySamples?: number;
  /** False for Silent exports (frames and lengths verified; no sound to listen to). */
  audioChecked?: boolean;
  /** Decoded audio vs the audio that was encoded (offset and similarity). */
  alignment?: { offsetMs: number; correlation: number; ok: boolean };
};

export function checkKind(e: NoteEvent): CheckKind {
  if (e.legato) return 'skipped';
  if (e.tech.includes('dead') || e.tech.includes('harmonic')) return 'onset-only';
  return 'full';
}

function pitchMatches(e: NoteEvent, midi: number): 'exact' | 'octave' | null {
  const hi = e.midi + Math.ceil(e.bendSemitones ?? 0);
  if (midi >= e.midi && midi <= hi) return 'exact';
  if (Math.abs(midi - e.midi) % 12 === 0) return 'octave';
  return null;
}

export function matchNotes(
  t: Timeline,
  detected: readonly DetectedNote[],
  onsetsMs: readonly number[],
  fps: number,
): { matches: NoteMatch[]; extras: DetectedNote[] } {
  const tolerance = 1000 / fps;
  const used = new Set<number>();
  const matches: NoteMatch[] = [];

  const nearestOnset = (ms: number) => {
    let best: number | null = null;
    for (const o of onsetsMs) if (best === null || Math.abs(o - ms) < Math.abs(best - ms)) best = o;
    return best;
  };

  for (const e of t.events) {
    const kind = checkKind(e);
    const base = { eventId: e.id, expectedMs: e.startMs, expectedMidi: e.midi, kind };
    if (kind === 'skipped') {
      matches.push({ ...base, onsetMs: null, errorMs: null, onsetOk: true, detectedMidi: null, pitchOk: true, ok: true, detail: 'legato (not re-picked): not checked' });
      continue;
    }
    const onset = nearestOnset(e.startMs);
    const errorMs = onset === null ? null : onset - e.startMs;
    const onsetOk = errorMs !== null && Math.abs(errorMs) <= tolerance;

    let pitchOk = kind === 'onset-only';
    let detectedMidi: number | null = null;
    let octave = false;
    if (kind === 'full') {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < detected.length; i++) {
        if (used.has(i)) continue;
        const d = detected[i]!;
        const dt = Math.abs(d.startMs - e.startMs);
        if (dt > PITCH_SEARCH_MS) continue;
        const pm = pitchMatches(e, d.midi);
        if (!pm) continue;
        const score = dt + (pm === 'octave' ? 1000 : 0); // prefer exact pitch
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0) {
        used.add(best);
        detectedMidi = detected[best]!.midi;
        pitchOk = true;
        octave = bestScore >= 1000;
      }
    }
    const ok = onsetOk && pitchOk;
    let detail = ok ? (octave ? 'ok (heard an octave away)' : 'ok') : '';
    if (!onsetOk) detail = errorMs === null ? 'no attack heard' : `attack ${errorMs > 0 ? 'late' : 'early'} by ${Math.abs(errorMs).toFixed(1)} ms`;
    if (!pitchOk) detail = (detail ? detail + '; ' : '') + `pitch ${e.midi} not heard`;
    if (kind === 'onset-only' && ok) detail = 'ok (attack only: ' + (e.tech.includes('dead') ? 'dead note' : 'harmonic') + ')';
    matches.push({ ...base, onsetMs: onset, errorMs, onsetOk, detectedMidi, pitchOk, ok, detail });
  }

  // The same pitch struck again right away: Basic Pitch hears one long note. The new attack itself
  // was verified (onset within a frame); accept the pitch when that same pitch is still sounding
  // (a detection that began at or before the previous strike and lasts past this one).
  for (const m of matches) {
    if (m.pitchOk || m.kind !== 'full' || !m.onsetOk) continue;
    const e = t.events.find((x) => x.id === m.eventId)!;
    const prev = [...t.events].reverse().find((x) => x.startMs < e.startMs && x.midi === e.midi && x.startMs >= e.startMs - 2000);
    if (!prev) continue;
    const d = detected.find((x) => x.midi === e.midi && x.startMs <= e.startMs - PITCH_SEARCH_MS / 2 && x.startMs >= prev.startMs - PITCH_SEARCH_MS && x.startMs + x.durationMs >= e.startMs);
    if (!d) continue;
    m.pitchOk = true;
    m.detectedMidi = d.midi;
    m.ok = true;
    m.detail = 'ok (re-struck: attack heard; the pitch detector hears one long note)';
  }

  // A chord's low root on a sampled guitar has a weak fundamental, and Basic Pitch then hears only
  // the octave — which, when that octave is itself a note of the same chord, was already claimed by
  // that note. Accept the root through it (narrowly: same chord, exact octave, at this onset).
  for (const m of matches) {
    if (m.pitchOk || m.kind !== 'full') continue;
    const e = t.events.find((x) => x.id === m.eventId)!;
    if (e.chordId === undefined) continue;
    const siblings = t.events.filter((x) => x.chordId === e.chordId && x.id !== e.id);
    const d = detected.find(
      (x) => Math.abs(x.startMs - e.startMs) <= PITCH_SEARCH_MS && x.midi > e.midi && (x.midi - e.midi) % 12 === 0 && siblings.some((s) => s.midi === x.midi),
    );
    if (!d) continue;
    m.pitchOk = true;
    m.detectedMidi = d.midi;
    m.ok = m.onsetOk;
    m.detail = m.ok ? `ok (chord root heard through its octave ${d.midi})` : m.detail.replace(`; pitch ${e.midi} not heard`, '').replace(`pitch ${e.midi} not heard`, '');
  }

  // Extras: detections not explained by any sounding note (re-detected sustain, harmonics, bend steps).
  const extras = detected.filter((d, i) => {
    if (used.has(i) || d.amplitude < EXTRA_MIN_AMPLITUDE) return false;
    return !t.events.some((e) => {
      const sounding = d.startMs >= e.startMs - PITCH_SEARCH_MS && d.startMs <= e.startMs + e.durationMs + PITCH_SEARCH_MS;
      if (!sounding) return false;
      const diff = d.midi - e.midi;
      return pitchMatches(e, d.midi) !== null || HARMONIC_OFFSETS.includes(diff) || (e.tech.includes('slide') && Math.abs(diff) <= 12);
    });
  });
  return { matches, extras };
}
