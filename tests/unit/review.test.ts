import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { applyEdits } from '../../src/engine/edits';
import { fingeringEdits, noteFlags, refKey, reviewBars } from '../../src/engine/review';
import { loadAlphaTex } from '../../src/import/alphatab';

const HEAD = '\\tempo 120 \\track "G" \\staff {tabs} \\tuning (E4 B3 G3 D3 A2 E2)\n';
const tl = (tex: string) => buildTimeline(loadAlphaTex(HEAD + tex), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;

describe('reviewBars', () => {
  it('shows each bar once even when it repeats', () => {
    const bars = reviewBars(tl('\\ro \\rc 3 :4 1.6 2.6 3.6 4.6 | :2 0.6 r'));
    expect(bars.map((b) => b.index)).toEqual([0, 1]);
    expect(bars[0]!.notes).toHaveLength(4);
    expect(bars[1]!.notes).toHaveLength(1);
    expect(bars[0]!.notes[1]!.startMs - bars[0]!.startMs).toBe(500);
  });
});

describe('noteFlags', () => {
  it('flags impossible chord stretches in red', () => {
    const t = tl(':4 (1.6 9.5) 3.1');
    const flags = noteFlags(t);
    expect(flags.get(refKey(t.events[0]!.ref!))?.[0]).toMatchObject({ level: 'error' });
    expect(flags.get(refKey(t.events[2]!.ref!))).toBeUndefined();
  });
  it('flags low confidence in amber', () => {
    const t = tl(':4 1.6 3.1');
    t.events[1]!.confidence = 0.4;
    expect(noteFlags(t).get(refKey(t.events[1]!.ref!))?.[0]).toMatchObject({ level: 'warn' });
  });
});

describe('fingeringEdits', () => {
  it('produces position edits that, applied to the score, give the optimized fingering', () => {
    const tex = ':8 5.6 8.6 12.5 15.5 7.4 0.3';
    const before = tl(tex);
    const edits = fingeringEdits(before);
    expect(edits.length).toBeGreaterThan(0);
    const score = loadAlphaTex(HEAD + tex);
    expect(applyEdits(score, 0, edits).errors).toEqual([]);
    const after = buildTimeline(score, { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
    expect(after.events.map((e) => e.midi)).toEqual(before.events.map((e) => e.midi)); // same pitches
    expect(fingeringEdits(after)).toEqual([]); // already optimal now
  });
});
