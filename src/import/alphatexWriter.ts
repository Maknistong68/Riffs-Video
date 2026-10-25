/**
 * Notes + 16th-grid durations → alphaTex, so pasted tabs and transcribed audio become real
 * alphaTab scores (same synth, same timeline path, same Sync Report as everything else).
 * Also returns the score address (bar/voice/beat/note) of every written note.
 */
import type { NoteRef } from '../engine/timeline';
import { splitDuration, UNITS_PER_BAR } from './rhythm';

export type WriterNote = {
  stringIdx: number; // 0 = highest string
  fret: number;
  hammerToNext?: boolean;
  slideToNext?: boolean;
  bendSemitones?: number;
  release?: boolean;
  vibrato?: boolean;
  palmMute?: boolean;
  harmonic?: boolean;
  dead?: boolean;
};

/** One onset (chord or single note); empty notes = rest. `units` = 16ths until the next onset. */
export type WriterColumn = { notes: WriterNote[]; units: number };

export type WriterInput = {
  title: string;
  artist?: string;
  tempo: number;
  tuning: number[]; // MIDI, index 0 = highest string
  capo: number;
  columns: WriterColumn[];
  /** Silence before the first note, in 16ths. */
  pickupUnits?: number;
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToNoteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function quote(s: string): string {
  return `"${s.replace(/["\\]/g, '')}"`;
}

function effects(n: WriterNote): string {
  const fx: string[] = [];
  if (n.hammerToNext) fx.push('h');
  if (n.slideToNext) fx.push('sl');
  if (n.bendSemitones) {
    const v = Math.round(n.bendSemitones * 2);
    fx.push(n.release ? `b (0 ${v} 0)` : `b (0 ${v})`);
  }
  if (n.vibrato) fx.push('v');
  if (n.palmMute) fx.push('pm');
  if (n.harmonic) fx.push('nh');
  return fx.length ? `{${fx.join(' ')}}` : '';
}

export function writeAlphaTex(input: WriterInput): { text: string; refs: (NoteRef | null)[][] } {
  const lines: string[] = [
    `\\title ${quote(input.title || 'Untitled riff')}`,
    ...(input.artist ? [`\\artist ${quote(input.artist)}`] : []),
    `\\tempo ${Math.round(input.tempo)}`,
    `\\track "Guitar"`,
    `\\staff {tabs}`,
    `\\tuning (${input.tuning.map(midiToNoteName).join(' ')})`,
    ...(input.capo > 0 ? [`\\capo ${input.capo}`] : []),
  ];
  const bars: string[][] = [[]];
  const beatIdx: number[] = [0];
  let pos = 0;
  let curDur = 0;
  const refs: (NoteRef | null)[][] = [];

  const emit = (body: string, piece: { duration: number; dotted: boolean; units: number }) => {
    const bar = bars[bars.length - 1]!;
    const dur = curDur !== piece.duration ? `:${piece.duration} ` : '';
    curDur = piece.duration;
    bar.push(`${dur}${body}${piece.dotted ? ' {d}' : ''}`);
    beatIdx[bars.length - 1]!++;
    pos += piece.units;
    if (pos % UNITS_PER_BAR === 0) {
      bars.push([]);
      beatIdx.push(0);
    }
  };
  const restOf = (units: number) => {
    for (const p of splitDuration(pos, units)) emit('r', p);
  };

  if (input.pickupUnits) restOf(input.pickupUnits);
  for (const col of input.columns) {
    const units = Math.max(1, Math.round(col.units));
    if (col.notes.length === 0) {
      refs.push([]);
      restOf(units);
      continue;
    }
    const pieces = splitDuration(pos, units);
    const notes = [...col.notes].sort((a, b) => a.stringIdx - b.stringIdx);
    const order = col.notes.map((n) => notes.indexOf(n));
    refs.push(order.map((k) => ({ bar: bars.length - 1, voice: 0, beat: beatIdx[bars.length - 1]!, note: k })));
    pieces.forEach((piece, i) => {
      const last = i === pieces.length - 1;
      // Linking effects (h, slide) belong on the last tied piece; the rest on the struck one.
      const one = (n: WriterNote) => {
        const s = n.stringIdx + 1;
        if (i === 0) {
          const head = n.dead ? `x.${s}` : `${n.fret}.${s}`;
          return head + effects(last ? n : { ...n, hammerToNext: false, slideToNext: false });
        }
        return `-.${s}` + (last ? effects({ stringIdx: n.stringIdx, fret: n.fret, hammerToNext: !!n.hammerToNext, slideToNext: !!n.slideToNext }) : '');
      };
      const body = notes.length === 1 ? one(notes[0]!) : `(${notes.map(one).join(' ')})`;
      emit(body, piece);
    });
  }
  // Pad the last bar with rests so it is complete.
  if (pos % UNITS_PER_BAR !== 0) restOf(UNITS_PER_BAR - (pos % UNITS_PER_BAR));
  if (bars[bars.length - 1]!.length === 0) bars.pop();
  lines.push(bars.map((b) => b.join(' ')).join(' |\n'));
  return { text: lines.join('\n') + '\n', refs };
}
