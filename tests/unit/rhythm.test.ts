import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { refKey } from '../../src/engine/review';
import { loadAlphaTex } from '../../src/import/alphatab';
import { midiToNoteName, writeAlphaTex, type WriterColumn } from '../../src/import/alphatexWriter';
import { quantizeOnsets, splitDuration, tapTempo } from '../../src/import/rhythm';

/** Deterministic jitter (no Math.random in tests). */
const jitter = (i: number, amp: number) => amp * Math.sin(i * 12.9898) * 0.999;
const onsetsFrom = (units: number[], bpm: number, amp = 0) => {
  const g = 60_000 / bpm / 4;
  let t = 500;
  return units.map((u, i) => {
    const at = t + jitter(i, amp);
    t += u * g;
    return at;
  });
};

describe('quantizeOnsets', () => {
  const cases: [string, number[], number][] = [
    ['straight eighths @100', [2, 2, 2, 2, 2, 2, 2, 2], 100],
    ['quarters + eighths @90', [4, 4, 2, 2, 4, 2, 2, 4], 90],
    ['16th run @80', [1, 1, 1, 1, 2, 2, 4, 1, 1, 2], 80],
    ['dotted rhythm @120', [3, 1, 3, 1, 2, 2, 4], 120],
    ['halves and quarters @140', [8, 4, 4, 8, 4, 4], 140],
  ];
  for (const [name, units, bpm] of cases) {
    it(`${name} (with ±20 ms tap jitter)`, () => {
      const q = quantizeOnsets(onsetsFrom(units, bpm, 20));
      // 80 bpm 16ths and 160 bpm eighths are the same rhythm (k = 2): both are correct.
      const k = q.bpm / bpm > 1.5 ? 2 : q.bpm / bpm < 0.75 ? 0.5 : 1;
      expect(Math.abs(q.bpm / (bpm * k) - 1), `bpm ${q.bpm} vs ${bpm}×${k}`).toBeLessThan(0.03);
      expect(q.units.slice(0, -1)).toEqual(units.slice(0, -1).map((u) => u * k));
    });
  }
  it('uses endMs for the last note', () => {
    const on = onsetsFrom([2, 2, 2], 120);
    expect(quantizeOnsets(on, { endMs: on[2]! + 1000 }).units.at(-1)).toBe(8);
  });
});

describe('tapTempo', () => {
  it('median beat interval, robust to a stray tap', () => {
    expect(tapTempo([0, 500, 1000, 1500, 1720, 2000])).toBe(120);
    expect(tapTempo([0, 600])).toBeNull();
  });
});

describe('splitDuration', () => {
  it('breaks at bar lines and uses dotted values', () => {
    expect(splitDuration(0, 6).map((p) => [p.duration, p.dotted])).toEqual([[4, true]]);
    expect(splitDuration(14, 4).map((p) => p.units)).toEqual([2, 2]); // crosses the bar
    expect(splitDuration(0, 5).map((p) => p.units)).toEqual([4, 1]);
  });
});

describe('writeAlphaTex round trip', () => {
  const STD = [64, 59, 55, 50, 45, 40];
  it('note names with octaves', () => {
    expect(STD.map(midiToNoteName)).toEqual(['E4', 'B3', 'G3', 'D3', 'A2', 'E2']);
    expect(midiToNoteName(61)).toBe('C#4');
  });

  it('writes notes, chords, rests, ties across bars and techniques; refs point at the notes', () => {
    const columns: WriterColumn[] = [
      { notes: [{ stringIdx: 5, fret: 0, palmMute: true }], units: 2 },
      { notes: [{ stringIdx: 2, fret: 5, hammerToNext: true }], units: 2 },
      { notes: [{ stringIdx: 2, fret: 7 }], units: 3 },
      { notes: [], units: 1 },
      { notes: [{ stringIdx: 1, fret: 5, slideToNext: true }], units: 2 },
      { notes: [{ stringIdx: 1, fret: 8 }], units: 2 },
      { notes: [{ stringIdx: 2, fret: 7, bendSemitones: 2, release: true }], units: 6 }, // crosses into bar 2
      { notes: [{ stringIdx: 4, fret: 2 }, { stringIdx: 5, fret: 0 }, { stringIdx: 3, fret: 2 }], units: 4 },
      { notes: [{ stringIdx: 0, fret: 0, dead: true }], units: 2 },
      { notes: [{ stringIdx: 0, fret: 12, harmonic: true, vibrato: true }], units: 8 },
    ];
    const { text, refs } = writeAlphaTex({ title: 'RT', tempo: 120, tuning: STD, capo: 0, columns });
    const { timeline: t, warnings } = buildTimeline(loadAlphaTex(text), { ...DEFAULT_BUILD, trackIndex: 0 });
    expect(warnings).toEqual([]);
    const g = 125; // ms per 16th at 120 bpm
    const starts = columns.reduce<number[]>((acc, _c, i) => [...acc, i === 0 ? 1000 : acc[i - 1]! + columns[i - 1]!.units * g], []);
    const byRef = new Map(t.events.map((e) => [refKey(e.ref!), e]));
    columns.forEach((c, i) => {
      c.notes.forEach((n, k) => {
        const e = byRef.get(refKey(refs[i]![k]!))!;
        expect(e, `column ${i} note ${k}`).toBeDefined();
        expect([e.startMs, e.stringIdx, e.fret]).toEqual([starts[i], n.stringIdx, n.fret]);
      });
    });
    const ev = (i: number, k = 0) => byRef.get(refKey(refs[i]![k]!))!;
    expect(ev(0).tech).toContain('palmMute');
    expect(ev(2).tech).toContain('hammer');
    expect(ev(5)).toMatchObject({ legato: true });
    expect(ev(6).durationMs).toBe(6 * g); // tied across the bar line
    expect(ev(6).bendSemitones).toBe(2);
    expect(ev(8).tech).toContain('dead');
    expect(ev(9).tech).toEqual(expect.arrayContaining(['harmonic', 'vibrato']));
    expect(t.events.filter((e) => e.chordId)).toHaveLength(3);
  });

  it('pickup rest and capo', () => {
    const { text } = writeAlphaTex({ title: 'P', tempo: 100, tuning: STD, capo: 3, columns: [{ notes: [{ stringIdx: 0, fret: 0 }], units: 4 }], pickupUnits: 4 });
    const t = buildTimeline(loadAlphaTex(text), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
    expect(t.capo).toBe(3);
    expect(t.events[0]!.startMs).toBe(1000 + 600);
  });
});
