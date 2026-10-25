import { describe, expect, it } from 'vitest';
import { hash01, humanizeMidi, humanVelocity } from '../../src/audio/humanize';

describe('velocity humanize (P8)', () => {
  it('is deterministic, bounded, and varies between notes', () => {
    expect(humanVelocity(95, 960, 64, 960)).toBe(humanVelocity(95, 960, 64, 960));
    const vs = Array.from({ length: 200 }, (_, i) => humanVelocity(95, 480 * i + 120, 40 + (i % 20), 960));
    expect(new Set(vs).size).toBeGreaterThan(10);
    for (const v of vs) {
      expect(v).toBeGreaterThanOrEqual(Math.floor(95 * 0.88));
      expect(v).toBeLessThanOrEqual(Math.ceil(95 * 1.12));
    }
    expect(humanVelocity(127, 0, 64, 960)).toBeLessThanOrEqual(127);
    expect(humanVelocity(0, 0, 64, 960)).toBe(0); // note-off style velocity untouched
    for (let i = 0; i < 1000; i++) expect(hash01(i, i * 7)).toBeLessThan(1);
  });
  it('accents notes on the beat on average', () => {
    const on = Array.from({ length: 300 }, (_, i) => humanVelocity(90, 960 * i, 50 + (i % 30), 960));
    const off = Array.from({ length: 300 }, (_, i) => humanVelocity(90, 960 * i + 240, 50 + (i % 30), 960));
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(avg(on)).toBeGreaterThan(avg(off));
  });
  it('changes only note-on velocities, never timing, and restores the shared MIDI afterwards', () => {
    const ev = [
      { type: 128, tick: 0, noteKey: 64, noteVelocity: 100 },
      { type: 128, tick: 240, noteKey: 67, noteVelocity: 100 },
      { type: 176, tick: 0 },
    ];
    const restore = humanizeMidi([{ events: ev }], 960);
    expect(ev.map((e) => e.tick)).toEqual([0, 240, 0]);
    expect(ev[1]!.noteVelocity).not.toBe(100);
    restore();
    expect(ev.map((e) => e.noteVelocity)).toEqual([100, 100, undefined]);
  });
});
