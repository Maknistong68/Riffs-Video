/** alphaTab Note/Beat → our Technique / finger / pick fields (CLAUDE.md §5). */
import { alphaTab } from '../import/alphatab';
import type { NoteEvent, Technique } from './timeline';

type Note = alphaTab.model.Note;
type Beat = alphaTab.model.Beat;
const { BendType, Fingers, HarmonicType, PickStroke, SlideOutType, SlideInType, VibratoType } = alphaTab.model;

export function techniquesOf(note: Note): Technique[] {
  const tech: Technique[] = [];
  if (note.isHammerPullDestination && note.hammerPullOrigin) {
    tech.push(note.fret >= note.hammerPullOrigin.fret ? 'hammer' : 'pull');
  }
  if (
    note.slideOutType !== SlideOutType.None ||
    note.slideInType !== SlideInType.None ||
    note.slideOrigin !== null
  ) {
    tech.push('slide');
  }
  if (note.hasBend) tech.push(note.bendType === BendType.Release ? 'release' : 'bend');
  if (note.isPalmMute) tech.push('palmMute');
  if (note.vibrato !== VibratoType.None) tech.push('vibrato');
  if (note.harmonicType !== HarmonicType.None) tech.push('harmonic');
  if (note.isDead) tech.push('dead');
  return tech;
}

/** alphaTab bend point values are quarter tones. */
export function bendSemitonesOf(note: Note): number | undefined {
  if (!note.hasBend || !note.maxBendPoint) return undefined;
  return note.maxBendPoint.value / 2;
}

export function fingerOf(note: Note): NoteEvent['finger'] {
  switch (note.leftHandFinger) {
    case Fingers.Thumb:
      return 'T';
    case Fingers.IndexFinger:
      return 1;
    case Fingers.MiddleFinger:
      return 2;
    case Fingers.AnnularFinger:
      return 3;
    case Fingers.LittleFinger:
      return 4;
    default:
      return undefined;
  }
}

export function pickOf(beat: Beat): NoteEvent['pick'] {
  if (beat.pickStroke === PickStroke.Down) return 'down';
  if (beat.pickStroke === PickStroke.Up) return 'up';
  return undefined;
}
