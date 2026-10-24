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
