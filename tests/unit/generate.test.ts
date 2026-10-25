import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { GEN_GENRES, generateRiff, riffOfTheDaySeed, type GenDifficulty } from '../../src/engine/generate';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';

const SCALE_PCS: Record<string, number[]> = {
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
};
const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

describe('generateRiff', () => {
  const difficulties: GenDifficulty[] = ['easy', 'medium', 'hard'];
  for (const g of GEN_GENRES) {
    for (const d of difficulties) {
      it(`${g.id} / ${d}: valid, playable, in key, deterministic`, () => {
        for (const seed of [1, 42, 2026, 99991]) {
          const r = generateRiff({ genre: g.id, difficulty: d, bars: 4, seed });
          expect(generateRiff({ genre: g.id, difficulty: d, bars: 4, seed })).toEqual(r);
          const t = buildTimeline(loadAlphaTex(r.alphaTex), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
          expect(validateTimeline(t), r.alphaTex).toEqual([]);
          expect(t.events.length).toBeGreaterThanOrEqual(6);
          expect(t.bars.length).toBe(4);
          const key = PCS.indexOf(r.key);
          const scale = SCALE_PCS[r.scale]!;
          // Every struck pitch is in the scale (bends land on a scale note too); power-chord fifths may sit outside.
          for (const e of t.events) {
            if (e.chordId) continue;
            expect(scale, `${r.title}: midi ${e.midi}`).toContain((((e.midi - key) % 12) + 12) % 12);
          }
          // One hand position: fretted notes within a 5-fret window.
          const frets = t.events.filter((e) => e.fret > 0).map((e) => e.fret);
          if (frets.length) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
          // Ends on the root, with vibrato.
          const last = t.events[t.events.length - 1]!;
          expect((((last.midi - key) % 12) + 12) % 12).toBe(0);
          if (d === 'easy') expect(t.events.some((e) => e.tech.includes('bend'))).toBe(false);
        }
      });
    }
  }
  it('different seeds give different riffs; riff of the day is stable per date', () => {
    const a = generateRiff({ genre: 'rock', difficulty: 'medium', bars: 4, seed: 1 }).alphaTex;
    const b = generateRiff({ genre: 'rock', difficulty: 'medium', bars: 4, seed: 2 }).alphaTex;
    expect(a).not.toBe(b);
    expect(riffOfTheDaySeed(new Date(2026, 9, 25, 8))).toBe(riffOfTheDaySeed(new Date(2026, 9, 25, 23)));
    expect(riffOfTheDaySeed(new Date(2026, 9, 25))).not.toBe(riffOfTheDaySeed(new Date(2026, 9, 26)));
  });
  it('2-bar riffs and fixed tempo are honoured', () => {
    const r = generateRiff({ genre: 'blues', difficulty: 'easy', bars: 2, seed: 7, bpm: 80 });
    const t = buildTimeline(loadAlphaTex(r.alphaTex), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
    expect(t.bars.length).toBe(2);
    expect(t.tempoMap[0]!.bpm).toBe(80);
  });
});
