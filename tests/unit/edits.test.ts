import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { applyEdits, type RiffEdit } from '../../src/engine/edits';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';

const HEAD = '\\tempo 120 \\track "G" \\staff {tabs} \\tuning (E4 B3 G3 D3 A2 E2)\n';
const TEX = HEAD + ':4 5.3 7.3 5.2 8.2 | (0.6 2.5 2.4) 3.1 3.1 r';
const ref = (bar: number, beat: number, note = 0) => ({ bar, voice: 0, beat, note });

function run(edits: RiffEdit[], tex = TEX) {
  const score = loadAlphaTex(tex);
  const r = applyEdits(score, 0, edits);
  const built = buildTimeline(score, { ...DEFAULT_BUILD, trackIndex: 0 });
  // The regenerated MIDI must agree with the edited timeline (no cross-check warnings).
  expect(built.warnings).toEqual([]);
  expect(validateTimeline(built.timeline)).toEqual([]);
  return { ...r, t: built.timeline };
}

describe('stable refs', () => {
  it('events carry bar/voice/beat/note refs and ids that survive re-parsing', () => {
    const a = run([]).t;
    const b = run([]).t;
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(a.events[0]!.ref).toEqual(ref(0, 0));
    expect(a.events.find((e) => e.fret === 3 && e.stringIdx === 0)!.ref).toEqual(ref(1, 1));
  });
});

describe('applyEdits', () => {
  it('moves a note to another string/fret (pitch follows)', () => {
    const { t, errors } = run([{ kind: 'position', ref: ref(0, 0), stringIdx: 3, fret: 10 }]);
    expect(errors).toEqual([]);
    expect(t.events[0]).toMatchObject({ stringIdx: 3, fret: 10, midi: 60 });
  });

  it('rejects impossible positions', () => {
    expect(run([{ kind: 'position', ref: ref(0, 0), stringIdx: 2, fret: 25 }]).errors[0]).toMatch(/Fret/);
    expect(run([{ kind: 'position', ref: ref(1, 0, 0), stringIdx: 4, fret: 7 }]).errors[0]).toMatch(/already on that string/);
  });

  it('changes a duration and shifts later notes', () => {
    const { t } = run([{ kind: 'duration', ref: ref(0, 0), duration: 8, dots: 0 }]);
    expect(t.events.slice(0, 2).map((e) => e.startMs)).toEqual([1000, 1250]);
    const dotted = run([{ kind: 'duration', ref: ref(0, 0), duration: 4, dots: 1 }]).t;
    expect(dotted.events[1]!.startMs).toBe(1750);
  });

  it('hammer-on / pull-off attach to the destination', () => {
    const { t } = run([{ kind: 'technique', ref: ref(0, 1), tech: 'hammer', on: true }]);
    expect(t.events[1]!.tech).toEqual(['hammer']);
    const off = run([
      { kind: 'technique', ref: ref(0, 1), tech: 'hammer', on: true },
      { kind: 'technique', ref: ref(0, 1), tech: 'hammer', on: false },
    ]).t;
    expect(off.events[1]!.tech).toEqual([]);
    expect(run([{ kind: 'technique', ref: ref(0, 2), tech: 'hammer', on: true }]).errors[0]).toMatch(/previous note on the same string/);
  });

  it('slide makes the destination legato', () => {
    const { t } = run([{ kind: 'technique', ref: ref(0, 3), tech: 'slide', on: true }]);
    expect(t.events[3]).toMatchObject({ fret: 8, legato: true });
    expect(t.events[3]!.tech).toContain('slide');
  });

  it('bend amount, palm mute, vibrato, harmonic, dead, finger', () => {
    const { t, errors } = run([
      { kind: 'technique', ref: ref(1, 1), tech: 'bend', on: true, bendSemitones: 1 },
      { kind: 'technique', ref: ref(1, 2), tech: 'palmMute', on: true },
      { kind: 'technique', ref: ref(0, 0), tech: 'vibrato', on: true },
      { kind: 'technique', ref: ref(0, 2), tech: 'harmonic', on: true },
      { kind: 'technique', ref: ref(0, 3), tech: 'dead', on: true },
      { kind: 'finger', ref: ref(0, 1), finger: 3 },
    ]);
    expect(errors).toEqual([]);
    const byRef = (bar: number, beat: number) => t.events.find((e) => e.ref?.bar === bar && e.ref.beat === beat)!;
    expect(byRef(1, 1)).toMatchObject({ tech: ['bend'], bendSemitones: 1 });
    expect(byRef(1, 2).tech).toEqual(['palmMute']);
    expect(byRef(0, 0).tech).toEqual(['vibrato']);
    expect(byRef(0, 2).tech).toEqual(['harmonic']);
    expect(byRef(0, 3).tech).toEqual(['dead']);
    expect(byRef(0, 1).finger).toBe(3);
  });

  it('deletes a note (beat becomes a rest if empty)', () => {
    const { t } = run([{ kind: 'deleteNote', ref: ref(0, 0) }]);
    expect(t.events).toHaveLength(8); // 9 notes in TEX
    expect(t.events[0]!.startMs).toBe(1500);
  });

  it('retunes and sets capo — midi follows', () => {
    const { t } = run([
      { kind: 'tuning', tuning: [64, 59, 55, 50, 45, 38] },
      { kind: 'capo', capo: 2 },
    ]);
    expect(t.tuning[5]).toBe(38);
    expect(t.capo).toBe(2);
    const low = t.events.find((e) => e.stringIdx === 5)!;
    expect(low.midi).toBe(38 + 2 + 0);
  });

  it('keeps going after a bad edit and reports it', () => {
    const r = run([
      { kind: 'position', ref: ref(9, 0), stringIdx: 0, fret: 1 },
      { kind: 'finger', ref: ref(0, 0), finger: 1 },
    ]);
    expect(r.applied).toBe(1);
    expect(r.errors[0]).toMatch(/No note at bar 10/);
    expect(r.t.events[0]!.finger).toBe(1);
  });
});
