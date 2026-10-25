/**
 * Audio → riff (phase 3). Basic Pitch notes are cleaned up, snapped to precise flux onsets,
 * grouped into chords, given a rhythm by the quantizer and a fingering by the optimizer, then
 * written as alphaTex (so playback/export use the normal score path). Pure: the worker supplies
 * the Basic Pitch detections and the flux onsets.
 */
import { attackRatio } from '../audio/envelope';
import type { DetectedNote } from '../audio/transcribe';
import { optimizeFingering } from '../engine/fingering';
import { refKey } from '../engine/review';
import type { NoteEvent } from '../engine/timeline';
import { writeAlphaTex, type WriterColumn } from './alphatexWriter';
import { quantizeOnsets } from './rhythm';

export type TranscribeOptions = { tuning: number[]; capo: number; title: string };

export type CleanNote = DetectedNote & { confidence: number; snapped: boolean; bendSemitones?: number; release?: boolean; slideToNext?: boolean };

export type TranscribedRiff = {
  alphaTex: string;
  bpm: number;
  units: number[];
  notes: CleanNote[];
  /** Confidence per written note, keyed by note ref (bar.voice.beat.note). */
  noteConfidence: Record<string, number>;
  /** Detections dropped as noise / ghosts (for the UI summary). */
  dropped: number;
};

export const MIN_AMPLITUDE = 0.3;
export const MIN_DURATION_MS = 60;
const SNAP_MS = 60;
const CHORD_MS = 35;
/** Intervals at which Basic Pitch reports overtones of a louder note as separate notes. */
const GHOST_INTERVALS = [7, 12, 19, 24, 28];
/** Basic Pitch also reports a quieter octave *below* chord tones. */
const GHOST_INTERVALS_BELOW = [12];
/** A real chord octave is about as loud as its root; an overtone ghost is much quieter. */
const GHOST_RATIO = 0.55;
/** In a strum, partials this much quieter than the loudest note are not notes. */
const WEAK_IN_CHORD = 0.4;
/** In a strum, a re-reported ringing note is much quieter than the re-struck ones. */
const RETRIGGER_IN_CHORD = 0.5;
/** Notes with no heard attack must be clearly audible to count. */
const UNSNAPPED_MIN_AMPLITUDE = 0.4;
/** Passing pitches of a slide are very short; bend steps last longer. */
const SLIDE_STEP_MAX_MS = 140;
/** Energy rise at a pick attack (measured ≥ 1.3 even for hammer-ons; bend/slide steps ≈ 1.0). */
const ATTACK_RATIO = 1.2;

export type Detection = DetectedNote & { snapped: boolean; bendSemitones?: number; release?: boolean; slideToNext?: boolean };

/**
 * Remove noise, out-of-range notes, overtone ghosts, re-triggers of ringing notes and unheard
 * blips; snap onsets to flux attacks; collapse pitch glides into bends / slides.
 */
export function cleanDetections(
  detected: readonly DetectedNote[],
  onsetsMs: readonly number[],
  tuning: readonly number[],
  capo: number,
  envelope?: ArrayLike<number>,
): CleanNote[] {
  const lo = Math.min(...tuning) + capo;
  const hi = Math.max(...tuning) + capo + 24;
  let notes: Detection[] = detected
    .filter((d) => d.amplitude >= MIN_AMPLITUDE && d.durationMs >= MIN_DURATION_MS && d.midi >= lo && d.midi <= hi)
    .map((d) => {
      let best: number | null = null;
      for (const o of onsetsMs) if (Math.abs(o - d.startMs) <= SNAP_MS && (best === null || Math.abs(o - d.startMs) < Math.abs(best - d.startMs))) best = o;
      return { ...d, startMs: best ?? d.startMs, snapped: best !== null };
    })
    .sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);

  const together = (a: Detection, b: Detection) => a !== b && Math.abs(a.startMs - b.startMs) <= 40;
  // Overtone ghosts above (and sub-octave ghosts below) a much louder simultaneous note.
  notes = notes.filter(
    (d) =>
      !notes.some(
        (o) =>
          o !== d &&
          Math.abs(o.startMs - d.startMs) < 60 &&
          d.amplitude < GHOST_RATIO * o.amplitude &&
          (GHOST_INTERVALS.includes(d.midi - o.midi) || GHOST_INTERVALS_BELOW.includes(o.midi - d.midi)),
      )
  );
  // A lone octave dyad whose top is clearly quieter is the root's overtone (palm-muted chugs).
  notes = notes.filter((d) => {
    const group = notes.filter((o) => together(o, d));
    const root = group.length === 1 ? group[0]! : null;
    return !(root && d.midi - root.midi === 12 && d.amplitude < 0.85 * root.amplitude);
  });
  // Weak partials inside a strum.
  notes = notes.filter((d) => {
    const group = notes.filter((o) => together(o, d));
    return group.length === 0 || d.amplitude >= WEAK_IN_CHORD * Math.max(...group.map((o) => o.amplitude));
  });
  // No attack heard: keep only clearly audible notes, and never just before the same pitch's real attack.
  notes = notes.filter(
    (d) => d.snapped || (d.amplitude >= UNSNAPPED_MIN_AMPLITUDE && !notes.some((o) => o.snapped && o.midi === d.midi && o.startMs > d.startMs && o.startMs - d.startMs < 200)),
  );
  // Re-triggers: a still-ringing pitch re-reported when something new is struck. In a single-note
  // line any louder new note gives it away; in a strum, re-struck common tones are as loud as the
  // rest, so only a much quieter one is an artifact.
  const kept: Detection[] = [];
  for (const d of notes) {
    const ringing = [...kept].reverse().find((o) => o.midi === d.midi && o.startMs + o.durationMs >= d.startMs - 30);
    const others = notes.filter((o) => together(o, d) && o.midi !== d.midi);
    const loudest = Math.max(0, ...others.map((o) => o.amplitude));
    const artifact = others.length === 1 ? loudest > d.amplitude : others.length >= 2 && d.amplitude < RETRIGGER_IN_CHORD * loudest;
    if (ringing && (artifact || !d.snapped)) {
      ringing.durationMs = Math.max(ringing.durationMs, d.startMs + d.durationMs - ringing.startMs);
      continue;
    }
    kept.push(d);
  }
  // A glide step has no new attack; without an envelope only semitone-scale steps qualify.
  const noAttack = (ms: number) => (envelope ? attackRatio(envelope, ms) < ATTACK_RATIO : true);
  return collapseGlides(kept, noAttack).map((d) => ({ ...d, confidence: confidenceOf(d) }));
}

/** Runs of 1–2 semitone steps with no gap = a glide: long steps → bend, very short steps → slide. */
function collapseGlides(notes: Detection[], noAttack: (ms: number) => boolean): Detection[] {
  const out: Detection[] = [];
  let i = 0;
  while (i < notes.length) {
    const chain = [notes[i]!];
    for (let j = i + 1; j < notes.length; j++) {
      const a = chain[chain.length - 1]!;
      const b = notes[j]!;
      if (b.startMs - a.startMs < 20) continue; // part of a chord, not the glide
      const step = b.midi - a.midi;
      const contiguous = b.startMs <= a.startMs + a.durationMs + 120 && b.startMs >= a.startMs + 40;
      const dir = chain.length > 1 ? Math.sign(chain[1]!.midi - chain[0]!.midi) : Math.sign(step);
      if (contiguous && Math.abs(step) >= 1 && Math.abs(step) <= 2 && Math.sign(step) === dir && notesAt(notes, b.startMs) === 1 && noAttack(b.startMs)) chain.push(b);
      else break;
    }
    if (chain.length < 2) {
      out.push(notes[i]!);
      i++;
      continue;
    }
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    const middle = chain.slice(1, -1);
    const quick = middle.length > 0 && middle.every((m) => m.durationMs <= SLIDE_STEP_MAX_MS);
    // Strings only bend up: a falling glide is a slide; so is a fast or wide one.
    if (quick || last.midi < first.midi || Math.abs(last.midi - first.midi) > 3) {
      // Slide: keep the start and the destination.
      out.push({ ...first, slideToNext: true }, { ...last });
    } else {
      // Bend: one note, bent up to the top of the glide.
      const top = Math.max(...chain.map((c) => c.midi));
      out.push({ ...first, durationMs: last.startMs + last.durationMs - first.startMs, bendSemitones: top - first.midi, release: last.midi < top });
    }
    i = notes.indexOf(last) + 1;
  }
  return out;
}

function notesAt(notes: readonly Detection[], ms: number): number {
  return notes.filter((n) => Math.abs(n.startMs - ms) < 20).length;
}

/** 0..1: loud, long-enough notes with a heard attack are trustworthy. */
export function confidenceOf(d: DetectedNote & { snapped: boolean }): number {
  const amp = Math.min(1, (d.amplitude - MIN_AMPLITUDE) / 0.45);
  const len = Math.min(1, d.durationMs / 150);
  const c = (0.45 + 0.55 * amp) * (0.75 + 0.25 * len) * (d.snapped ? 1 : 0.75);
  return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
}

/** Notes whose onsets are within CHORD_MS strike together (max one note per pitch). */
export function groupOnsets(notes: readonly CleanNote[]): CleanNote[][] {
  const groups: CleanNote[][] = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && n.startMs - g[0]!.startMs <= CHORD_MS && !g.some((o) => o.midi === n.midi) && g.length < 6) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

export function transcribeToRiff(
  detected: readonly DetectedNote[],
  onsetsMs: readonly number[],
  opts: TranscribeOptions,
  envelope?: ArrayLike<number>,
): TranscribedRiff {
  const notes = cleanDetections(detected, onsetsMs, opts.tuning, opts.capo, envelope);
  if (notes.length === 0) throw new Error('No clear notes found. Play a little louder and closer to the mic, one riff at a time.');
  const groups = groupOnsets(notes);
  const lastEnd = Math.max(...notes.map((n) => n.startMs + n.durationMs));
  const q = quantizeOnsets(groups.map((g) => g[0]!.startMs), { endMs: lastEnd });

  // Fingering: the optimizer picks string/fret for every pitch (nothing is "written" yet).
  const events = groups.flatMap((g, gi) =>
    g.map((n): NoteEvent => ({ id: `${gi}`, startMs: gi * 1000, durationMs: 500, stringIdx: -1, fret: -1, midi: n.midi, tech: [] })),
  );
  const positions = optimizeFingering({ events, tuning: opts.tuning, capo: opts.capo });
  let k = 0;
  const placed = groups.map((g) => {
    const withPos = g.map((n) => ({ n, p: positions[k++]! }));
    // Two pitches on one string only happens for chords unplayable in this tuning: keep the first.
    return withPos.filter((x, i) => withPos.findIndex((y) => y.p.stringIdx === x.p.stringIdx) === i);
  });
  const columns: WriterColumn[] = placed.map((g, gi) => ({
    notes: g.map(({ n, p }) => ({
      stringIdx: p.stringIdx,
      fret: p.fret,
      ...(n.bendSemitones ? { bendSemitones: n.bendSemitones, release: !!n.release } : {}),
      ...(n.slideToNext ? { slideToNext: true } : {}),
    })),
    units: q.units[gi] ?? 2,
  }));

  const { text, refs } = writeAlphaTex({ title: opts.title, tempo: q.bpm, tuning: opts.tuning, capo: opts.capo, columns });
  const noteConfidence: Record<string, number> = {};
  placed.forEach((g, gi) =>
    g.forEach(({ n }, ni) => {
      const r = refs[gi]?.[ni];
      if (r) noteConfidence[refKey(r)] = n.confidence;
    }),
  );
  return { alphaTex: text, bpm: q.bpm, units: q.units, notes, noteConfidence, dropped: detected.length - notes.length };
}

export type Accuracy = { precision: number; recall: number; f1: number; matched: number; truth: number; detected: number };

/**
 * Note-level accuracy: same MIDI pitch and onset within `tolMs` (mir_eval-style, one-to-one).
 * Legato truth notes (slide destinations) have no attack, so their pitch may arrive anywhere
 * during the slide: they get `legatoTolMs`.
 */
export function noteAccuracy(
  truth: readonly { startMs: number; midi: number; legato?: boolean }[],
  detected: readonly { startMs: number; midi: number }[],
  tolMs = 50,
  legatoTolMs = 150,
): Accuracy {
  const used = new Set<number>();
  let matched = 0;
  for (const t of truth) {
    let best = -1;
    let bestD = Infinity;
    detected.forEach((d, i) => {
      if (used.has(i) || d.midi !== t.midi) return;
      const dist = Math.abs(d.startMs - t.startMs);
      if (dist <= (t.legato ? legatoTolMs : tolMs) && dist < bestD) {
        best = i;
        bestD = dist;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  const precision = detected.length ? matched / detected.length : 0;
  const recall = truth.length ? matched / truth.length : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, matched, truth: truth.length, detected: detected.length };
}
