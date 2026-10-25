import { describe, expect, it } from 'vitest';
import { tabPreview } from '../../src/engine/tabPreview';
import type { NoteEvent, Timeline } from '../../src/engine/timeline';

const ev = (startMs: number, stringIdx: number, fret: number): NoteEvent => ({ id: `${startMs}-${stringIdx}`, startMs, durationMs: 100, stringIdx, fret, midi: 0, tech: [] });

describe('tabPreview', () => {
  it('writes one column per onset, chords stacked, bar lines between bars', () => {
    const t = {
      tuning: [64, 59, 55, 50, 45, 40],
      bars: [{ index: 0, startMs: 0 }, { index: 1, startMs: 1000 }],
      events: [ev(0, 5, 0), ev(500, 5, 3), ev(1000, 5, 12), ev(1000, 4, 14)],
    } as unknown as Timeline;
    expect(tabPreview(t).split('\n')).toEqual([
      'e|-----|---|',
      'B|-----|---|',
      'G|-----|---|',
      'D|-----|---|',
      'A|-----|14-|',
      'E|-0-3-|12-|',
    ]);
  });
});
