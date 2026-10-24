import { describe, expect, it } from 'vitest';
import { activeEvents, lastNotePerString, upperBound, validateTimeline, type Timeline } from '../../src/engine/timeline';
import { demoTimeline } from './helpers/demoTimeline';

const clone = (t: Timeline): Timeline => structuredClone(t);

describe('demo timeline', () => {
  it('is valid and has 8 notes', () => {
    const t = demoTimeline();
    expect(validateTimeline(t)).toEqual([]);
    expect(t.events).toHaveLength(8);
  });

  it('string index 5 is low E (P5: display order, 0 = high e)', () => {
    const t = demoTimeline();
    expect(t.tuning[0]).toBe(64);
    expect(t.tuning[5]).toBe(40);
    expect(t.events[0]).toMatchObject({ stringIdx: 5, fret: 0, midi: 40 });
  });
});

describe('validateTimeline', () => {
  it('flags pitch that disagrees with string + capo + fret', () => {
    const t = clone(demoTimeline());
    t.events[1]!.midi += 1;
    expect(validateTimeline(t).map((i) => i.eventId)).toEqual(['n1']);
  });

  it('accounts for capo', () => {
    const t = clone(demoTimeline());
    t.capo = 2;
    for (const e of t.events) e.midi += 2;
    expect(validateTimeline(t)).toEqual([]);
  });

  it('flags bad fret, string, ordering, lead-in and duplicate ids', () => {
    const t = clone(demoTimeline());
    t.events[0]!.fret = 25;
    t.events[1]!.stringIdx = 6;
    t.events[2]!.startMs = 100;
    t.events[3]!.id = 'n4';
    const msgs = validateTimeline(t).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Fret 25/);
    expect(msgs).toMatch(/String 6/);
    expect(msgs).toMatch(/not sorted/);
    expect(msgs).toMatch(/lead-in/);
    expect(msgs).toMatch(/Duplicate/);
  });
});

describe('lookups', () => {
  const t = demoTimeline();
  it('upperBound is a binary search over startMs', () => {
    expect(upperBound(t.events, 0)).toBe(0);
    expect(upperBound(t.events, 1000)).toBe(1);
    expect(upperBound(t.events, 1299)).toBe(1);
    expect(upperBound(t.events, 1300)).toBe(2);
    expect(upperBound(t.events, 1e9)).toBe(8);
  });

  it('activeEvents returns what is sounding', () => {
    expect(activeEvents(t, 999)).toEqual([]);
    expect(activeEvents(t, 1000).map((e) => e.id)).toEqual(['n0']);
    // n1 replaces n0 on the low E string
    expect(activeEvents(t, 1300).map((e) => e.id)).toEqual(['n1']);
    // gap between detached eighths: n0 ends at 1270
    expect(activeEvents(t, 1280)).toEqual([]);
  });

  it('lastNotePerString keeps one note per string', () => {
    const per = lastNotePerString(t, 2000);
    expect(per[5]?.id).toBe('n1');
    expect(per[4]?.id).toBe('n3');
    expect(per[0]).toBeNull();
  });
});
