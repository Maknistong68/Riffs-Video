/**
 * Riff Review edits, applied to the alphaTab Score (not to the timeline) so the regenerated
 * MIDI — and therefore the synth audio — always matches what is drawn (CLAUDE.md §3 rule 2).
 * Edits are replayed in order on a freshly parsed score; refs point at the score as it is
 * after the previous edits.
 */
import { alphaTab, createSettings, firstStringedStaff, type Score } from '../import/alphatab';
import { idxToAlphaTabString } from './strings';
import { MAX_FRET, type NoteEvent, type NoteRef } from './timeline';

type Note = alphaTab.model.Note;
type Beat = alphaTab.model.Beat;
const M = alphaTab.model;

export type BeatRef = Omit<NoteRef, 'note'>;
export type EditableTechnique = 'hammer' | 'slide' | 'bend' | 'palmMute' | 'vibrato' | 'harmonic' | 'dead';
export type DurationValue = 1 | 2 | 4 | 8 | 16 | 32;

export type RiffEdit =
  | { kind: 'position'; ref: NoteRef; stringIdx: number; fret: number }
  /** hammer/slide attach to the destination note (legato/slide *from* the previous note on that string). */
  | { kind: 'technique'; ref: NoteRef; tech: EditableTechnique; on: boolean; bendSemitones?: number }
  | { kind: 'finger'; ref: NoteRef; finger: NonNullable<NoteEvent['finger']> | null }
  | { kind: 'duration'; ref: BeatRef; duration: DurationValue; dots: 0 | 1 }
  | { kind: 'deleteNote'; ref: NoteRef }
  | { kind: 'tuning'; tuning: number[] }
  | { kind: 'capo'; capo: number };

export type ApplyResult = { applied: number; errors: string[] };

const FINGERS: Record<string, alphaTab.model.Fingers> = {
  T: M.Fingers.Thumb,
  1: M.Fingers.IndexFinger,
  2: M.Fingers.MiddleFinger,
  3: M.Fingers.AnnularFinger,
  4: M.Fingers.LittleFinger,
};

export function applyEdits(score: Score, trackIndex: number, edits: readonly RiffEdit[]): ApplyResult {
  const track = score.tracks[trackIndex];
  const staff = track && firstStringedStaff(track);
  if (!staff) return { applied: 0, errors: edits.length ? ['Track has no tablature staff'] : [] };
  const errors: string[] = [];
  let applied = 0;

  const beatAt = (r: BeatRef): Beat | undefined => staff.bars[r.bar]?.voices[r.voice]?.beats[r.beat];
  const noteAt = (r: NoteRef): Note | undefined => beatAt(r)?.notes[r.note];
  const where = (r: BeatRef) => `bar ${r.bar + 1}, beat ${r.beat + 1}`;

  for (const e of edits) {
    try {
      switch (e.kind) {
        case 'tuning':
          if (e.tuning.length !== staff.tuning.length) throw new Error(`Tuning needs ${staff.tuning.length} strings`);
          staff.stringTuning.tunings = [...e.tuning];
          break;
        case 'capo':
          if (!Number.isInteger(e.capo) || e.capo < 0 || e.capo > 12) throw new Error('Capo must be 0–12');
          staff.capo = e.capo;
          break;
        case 'duration': {
          const b = beatAt(e.ref);
          if (!b) throw new Error(`No beat at ${where(e.ref)}`);
          b.duration = e.duration as unknown as alphaTab.model.Duration;
          b.dots = e.dots;
          break;
        }
        case 'deleteNote': {
          const n = noteAt(e.ref);
          if (!n) throw new Error(`No note at ${where(e.ref)}`);
          n.beat.removeNote(n);
          break;
        }
        case 'position': {
          const n = noteAt(e.ref);
          if (!n) throw new Error(`No note at ${where(e.ref)}`);
          if (e.stringIdx < 0 || e.stringIdx >= staff.tuning.length) throw new Error('String out of range');
          if (!Number.isInteger(e.fret) || e.fret < 0 || e.fret > MAX_FRET) throw new Error(`Fret must be 0–${MAX_FRET}`);
          const target = idxToAlphaTabString(e.stringIdx, staff.tuning.length);
          if (n.beat.notes.some((o) => o !== n && o.string === target)) throw new Error('Another note in this chord is already on that string');
          n.string = target;
          n.fret = e.fret;
          if (n.harmonicType !== M.HarmonicType.None) n.harmonicValue = e.fret;
          break;
        }
        case 'finger': {
          const n = noteAt(e.ref);
          if (!n) throw new Error(`No note at ${where(e.ref)}`);
          n.leftHandFinger = e.finger === null ? M.Fingers.Unknown : FINGERS[String(e.finger)]!;
          break;
        }
        case 'technique': {
          const n = noteAt(e.ref);
          if (!n) throw new Error(`No note at ${where(e.ref)}`);
          setTechnique(n, e.tech, e.on, e.bendSemitones ?? 1);
          break;
        }
      }
      applied++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  score.finish(createSettings());
  return { applied, errors };
}

/** Previous note on the same string in the same voice (crossing bar lines). */
export function previousOnString(n: Note): Note | null {
  let b: Beat | null = n.beat.previousBeat;
  while (b) {
    const p = b.notes.find((o) => o.string === n.string);
    if (p) return p;
    if (b.notes.length > 0) return null; // something else was played in between
    b = b.previousBeat;
  }
  return null;
}

function setTechnique(n: Note, tech: EditableTechnique, on: boolean, bendSemitones: number): void {
  switch (tech) {
    case 'hammer': {
      const p = previousOnString(n);
      if (!p) throw new Error('Hammer-on/pull-off needs a previous note on the same string');
      p.isHammerPullOrigin = on;
      break;
    }
    case 'slide': {
      const p = previousOnString(n);
      if (!p) throw new Error('A slide needs a previous note on the same string');
      // Legato slide: destination is not re-picked (alphaTex {sl}). Shift would re-pick it.
      p.slideOutType = on ? M.SlideOutType.Legato : M.SlideOutType.None;
      break;
    }
    case 'bend':
      n.bendPoints = [];
      if (on) {
        n.addBendPoint(new M.BendPoint(0, 0));
        n.addBendPoint(new M.BendPoint(M.BendPoint.MaxPosition, Math.round(bendSemitones * 2)));
      }
      n.bendType = on ? M.BendType.Bend : M.BendType.None;
      break;
    case 'palmMute':
      n.isPalmMute = on;
      break;
    case 'vibrato':
      n.vibrato = on ? M.VibratoType.Slight : M.VibratoType.None;
      break;
    case 'harmonic':
      n.harmonicType = on ? M.HarmonicType.Natural : M.HarmonicType.None;
      n.harmonicValue = on ? n.fret : 0;
      break;
    case 'dead':
      n.isDead = on;
      break;
  }
}
