import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { difficultyLabel, hardestBar } from '../../src/engine/difficulty';
import { assignFingers, MAX_SPAN, optimizeFingering, positionsFor } from '../../src/engine/fingering';
import type { Timeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';

const HEAD = '\\tempo 120 \\track "G" \\staff {tabs} \\tuning (E4 B3 G3 D3 A2 E2)\n';
const tl = (tex: string): Timeline => buildTimeline(loadAlphaTex(HEAD + tex), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
const STD = [64, 59, 55, 50, 45, 40];

describe('positionsFor', () => {
  it('lists every place a pitch can be played', () => {
    expect(positionsFor(64, STD, 0).map((p) => `${p.stringIdx}:${p.fret}`)).toEqual(['0:0', '1:5', '2:9', '3:14', '4:19', '5:24']);
    expect(positionsFor(41, STD, 2)).toEqual([]); // below capo'd low E
  });
});

describe('optimizeFingering', () => {
  it('pulls a scattered run into one hand position', () => {
    // A minor pentatonic notes written all over the neck → should end up around the 5th position.
    const t = tl(':8 5.6 8.6 12.5 15.5 7.4 0.3');
    const pos = optimizeFingering(t);
    const fretted = pos.filter((p) => p.fret > 0).map((p) => p.fret);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(MAX_SPAN);
    // pitches are preserved
    pos.forEach((p, i) => expect(STD[p.stringIdx]! + p.fret).toBe(t.events[i]!.midi));
  });

  it('keeps chords playable and on distinct strings', () => {
    const t = tl(':4 (5.6 7.5 7.4) (15.4 17.3 17.2)');
    const pos = optimizeFingering(t);
    for (const chord of [pos.slice(0, 3), pos.slice(3, 6)]) {
      expect(new Set(chord.map((p) => p.stringIdx)).size).toBe(3);
      const f = chord.filter((p) => p.fret > 0).map((p) => p.fret);
      expect(Math.max(...f) - Math.min(...f)).toBeLessThanOrEqual(4);
    }
  });

  it('keeps hammer-ons on the same string', () => {
    const t = tl(':8 5.2{h} 7.2 5.2');
    const pos = optimizeFingering(t);
    expect(pos[0]!.stringIdx).toBe(pos[1]!.stringIdx);
  });

  it('leaves an already-good fingering alone', () => {
    const t = tl(':8 5.6 8.6 5.5 7.5 5.4 7.4');
    expect(optimizeFingering(t)).toEqual(t.events.map((e) => ({ stringIdx: e.stringIdx, fret: e.fret })));
  });
});

describe('assignFingers', () => {
  it('one finger per fret from the hand position; open strings get none', () => {
    const t = tl(':8 5.6 7.6 8.6 0.5 5.5 7.5');
    expect(assignFingers(t)).toEqual([1, 3, 4, undefined, 1, 3]);
  });
  it('respects fingers written in the file', () => {
    const t = tl(':8 5.6{lf 4} 7.6');
    expect(assignFingers(t)[0]).toBe(t.events[0]!.finger);
  });
});

describe('difficulty', () => {
  it('finds the busiest bar', () => {
    const t = tl(':4 0.6 r r r | :16 5.3 7.3 8.3 7.3 5.3 7.3 8.3 7.3 5.4 7.4 8.4 7.4 5.4 7.4 8.4 7.4 | :2 0.6 r');
    expect(hardestBar(t)!.barIndex).toBe(1);
    expect(difficultyLabel(t)).toBe('Hard');
    expect(difficultyLabel(tl(':2 0.6 r'))).toBe('Easy');
  });
});
