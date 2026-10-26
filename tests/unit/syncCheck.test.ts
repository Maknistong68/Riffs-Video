import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DetectedNote } from '../../src/audio/transcribe';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { matchNotes } from '../../src/export/syncCheck';

const root = join(__dirname, '..');
const load = (f: string) => {
  const { timeline } = buildTimeline(loadAlphaTex(readFileSync(join(root, 'golden/riffs', f + '.atex'), 'utf8')), { ...DEFAULT_BUILD, trackIndex: 0 });
  const fx = JSON.parse(readFileSync(join(root, 'fixtures/sync', f + '.json'), 'utf8')) as { onsets: number[]; detected: DetectedNote[] };
  return { timeline, ...fx };
};

describe('Sync Report matching on real Basic Pitch output', () => {
  for (const f of ['01-pentatonic-run', '02-chords', '05-techniques']) {
    for (const fps of [30, 60]) {
      it(`${f} @ ${fps} fps: every note matched`, () => {
        const { timeline, onsets, detected } = load(f);
        const { matches, extras } = matchNotes(timeline, detected, onsets, fps);
        const bad = matches.filter((m) => !m.ok);
        expect(bad).toEqual([]);
        expect(extras).toEqual([]);
        for (const m of matches) if (m.errorMs !== null) expect(Math.abs(m.errorMs)).toBeLessThan(8);
      });
    }
  }

  it('flags audio that is 25 ms late at 60 fps', () => {
    const { timeline, onsets, detected } = load('01-pentatonic-run');
    const { matches } = matchNotes(timeline, detected, onsets.map((o) => o + 25), 60);
    expect(matches.every((m) => !m.ok && /late by/.test(m.detail))).toBe(true);
  });

  it('flags a wrong pitch (string/fret mapping bug)', () => {
    const { timeline, onsets, detected } = load('01-pentatonic-run');
    const broken = structuredClone(timeline);
    broken.events[3]!.midi += 5;
    broken.events[3]!.fret += 5;
    const bad = matchNotes(broken, detected, onsets, 30).matches.filter((m) => !m.ok);
    expect(bad.map((m) => m.eventId)).toEqual([timeline.events[3]!.id]);
    expect(bad[0]!.detail).toMatch(/pitch \d+ not heard/);
  });

  it('flags a missing note and reports unexplained sounds', () => {
    const { timeline, onsets, detected } = load('01-pentatonic-run');
    const dropped = detected.filter((d) => Math.abs(d.startMs - timeline.events[5]!.startMs) > 70);
    expect(matchNotes(timeline, dropped, onsets, 30).matches.filter((m) => !m.ok)).toHaveLength(1);
    const noisy = [...detected, { startMs: 2050, durationMs: 100, midi: 80, amplitude: 0.9 }];
    expect(matchNotes(timeline, noisy, onsets, 30).extras.map((d) => d.midi)).toEqual([80]);
  });
});

describe('chord root heard through its octave (sampled guitars)', () => {
  const tl = (tex: string) => buildTimeline(loadAlphaTex(`\\tempo 100\n\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n${tex}`), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
  const det = (startMs: number, midi: number): DetectedNote => ({ startMs, durationMs: 400, midi, amplitude: 0.8 });

  it('accepts an E5 chord whose low E is heard only as the E3 that is also in the chord', () => {
    const t = tl(':2 (0.6 2.5 2.4)');
    const at = t.events[0]!.startMs;
    const { matches } = matchNotes(t, [det(at + 5, 52), det(at + 5, 47)], [at + 2], 30);
    expect(matches.every((m) => m.ok)).toBe(true);
    const root = matches.find((m) => m.expectedMidi === 40)!;
    expect(root.detail).toContain('octave');
  });

  it('still flags a chord root when its octave is not part of the chord', () => {
    const t = tl(':2 (0.6 2.5)'); // E2 + B2: no E3 in the chord
    const at = t.events[0]!.startMs;
    const { matches } = matchNotes(t, [det(at + 5, 47)], [at + 2], 30);
    expect(matches.find((m) => m.expectedMidi === 40)!.ok).toBe(false);
  });

  it('never applies to single notes', () => {
    const t = tl(':4 0.6 2.4');
    const a = t.events[0]!.startMs;
    const b = t.events[1]!.startMs;
    const { matches } = matchNotes(t, [det(b + 5, 52)], [a + 2, b + 2], 30);
    expect(matches.find((m) => m.expectedMidi === 40)!.ok).toBe(false);
  });
});

describe('same pitch struck twice (Basic Pitch hears one long note)', () => {
  const tl = (tex: string) => buildTimeline(loadAlphaTex(`\\tempo 120\n\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n${tex}`), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
  const det = (startMs: number, durationMs: number, midi: number): DetectedNote => ({ startMs, durationMs, midi, amplitude: 0.8 });

  it('accepts the re-strike when its attack is on time and the pitch is still sounding', () => {
    const t = tl(':8 0.6 0.6 3.6');
    const [a, b, c] = t.events.map((e) => e.startMs);
    const { matches } = matchNotes(t, [det(a! + 4, b! - a! + 200, 40), det(c! + 4, 200, 43)], [a! + 2, b! + 2, c! + 2], 30);
    expect(matches.every((m) => m.ok)).toBe(true);
    expect(matches[1]!.detail).toContain('re-struck');
  });

  it('still flags it when the attack is missing or the pitch stopped', () => {
    const t = tl(':8 0.6 0.6 3.6');
    const [a, b, c] = t.events.map((e) => e.startMs);
    const noAttack = matchNotes(t, [det(a! + 4, b! - a! + 200, 40), det(c! + 4, 200, 43)], [a! + 2, c! + 2], 30);
    expect(noAttack.matches[1]!.ok).toBe(false);
    const stopped = matchNotes(t, [det(a! + 4, 100, 40), det(c! + 4, 200, 43)], [a! + 2, b! + 2, c! + 2], 30);
    expect(stopped.matches[1]!.ok).toBe(false);
  });
});
