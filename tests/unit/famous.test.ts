import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { validateTimeline } from '../../src/engine/timeline';
import { FAMOUS_RIFFS, famousAlphaTex, famousNoteNames, noteMidi } from '../../src/demo/famous';
import { loadAlphaTex } from '../../src/import/alphatab';

describe('famous riffs', () => {
  it('has 20 riffs with unique ids', () => {
    expect(FAMOUS_RIFFS).toHaveLength(20);
    expect(new Set(FAMOUS_RIFFS.map((r) => r.id)).size).toBe(20);
  });

  it('noteMidi', () => {
    expect(noteMidi('C4')).toBe(60);
    expect(noteMidi('E2')).toBe(40);
    expect(noteMidi('Bb2')).toBe(46);
    expect(noteMidi('F#5')).toBe(78);
  });

  for (const r of FAMOUS_RIFFS) {
    it(`${r.title}: parses, validates, and sounds the written pitches`, () => {
      const tex = famousAlphaTex(r);
      const t = buildTimeline(loadAlphaTex(tex), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
      expect(validateTimeline(t), tex).toEqual([]);
      // Same pitches in the same order (notes struck together compared as a set).
      const expected = famousNoteNames(r).map(noteMidi);
      expect(t.events.length, tex).toBe(expected.length);
      const got: number[][] = [];
      let last = -1;
      for (const e of t.events) {
        if (e.startMs !== last) got.push([]);
        got[got.length - 1]!.push(e.midi);
        last = e.startMs;
      }
      let i = 0;
      for (const group of got) {
        const want = expected.slice(i, i + group.length);
        i += group.length;
        expect([...group].sort(), tex).toEqual([...want].sort());
      }
      // Short enough for a video, long enough to be the riff.
      expect(t.durationMs).toBeGreaterThan(4000);
      expect(t.durationMs).toBeLessThan(40000);
      // Every bar is exactly full for its time signature (a typo in a duration would shift the rhythm).
      const score = loadAlphaTex(tex);
      const bars = score.tracks[0]!.staves[0]!.bars;
      expect(bars.length).toBeGreaterThanOrEqual(2);
      for (const bar of bars) {
        const mb = bar.masterBar;
        const filled = bar.voices[0]!.beats.reduce((s, b) => s + b.playbackDuration, 0);
        expect(`${r.id} bar ${bar.index + 1}: ${filled}`).toBe(`${r.id} bar ${bar.index + 1}: ${mb.calculateDuration()}`);
      }
    });
  }
});

describe('famous riffs with teach passes', () => {
  it('every riff arranges into a valid timeline with hook first + speed-up and no tail', async () => {
    const { buildArrangement } = await import('../../src/engine/arrange');
    const { DEFAULT_TEACH } = await import('../../src/engine/teach');
    for (const r of FAMOUS_RIFFS) {
      const tex = famousAlphaTex(r);
      for (const teach of [DEFAULT_TEACH, { ...DEFAULT_TEACH, speedUp: true, slowMo: true }]) {
        const { timeline } = buildArrangement(() => loadAlphaTex(tex), { trackIndex: 0, leadInMs: 150, tailMs: 0, teach });
        expect(validateTimeline(timeline), r.id).toEqual([]);
      }
    }
  });
});
