import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DetectedNote } from '../../src/audio/transcribe';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { refKey } from '../../src/engine/review';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { cleanDetections, noteAccuracy, transcribeToRiff } from '../../src/import/transcribeRiff';

const root = join(__dirname, '..');
const STD = [64, 59, 55, 50, 45, 40];
const truthOf = (f: string) =>
  buildTimeline(loadAlphaTex(readFileSync(join(root, 'golden/riffs', f + '.atex'), 'utf8')), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
const fixture = (f: string) => JSON.parse(readFileSync(join(root, 'fixtures/sync', f + '.json'), 'utf8')) as { onsets: number[]; detected: DetectedNote[]; envelope: number[] };

describe('noteAccuracy', () => {
  it('one-to-one matching by pitch and onset', () => {
    const t = [{ startMs: 0, midi: 40 }, { startMs: 500, midi: 43 }];
    expect(noteAccuracy(t, t).f1).toBe(1);
    expect(noteAccuracy(t, [{ startMs: 30, midi: 40 }, { startMs: 500, midi: 44 }])).toMatchObject({ matched: 1, f1: 0.5 });
  });
});

describe('cleanDetections', () => {
  it('drops faint notes, harmonic ghosts and sustain re-detections', () => {
    const d: DetectedNote[] = [
      { startMs: 1000, durationMs: 400, midi: 45, amplitude: 0.8 },
      { startMs: 1005, durationMs: 300, midi: 57, amplitude: 0.3 }, // octave ghost (much quieter)
      { startMs: 1200, durationMs: 300, midi: 45, amplitude: 0.6 }, // re-detection, no attack
      { startMs: 1500, durationMs: 40, midi: 50, amplitude: 0.9 }, // too short
      { startMs: 1600, durationMs: 300, midi: 52, amplitude: 0.1 }, // too faint
    ];
    const c = cleanDetections(d, [1000], STD, 0);
    expect(c.map((n) => n.midi)).toEqual([45]);
    expect(c[0]!.durationMs).toBeGreaterThanOrEqual(500);
  });
});

describe('transcribed golden riffs (real Basic Pitch output on synth renders)', () => {
  for (const f of ['01-pentatonic-run', '02-chords', '05-techniques']) {
    it(`${f}: ≥ 90% note accuracy and a valid score with confidences`, () => {
      const truth = truthOf(f);
      const { onsets, detected, envelope } = fixture(f);
      const r = transcribeToRiff(detected, onsets, { tuning: truth.tuning, capo: truth.capo, title: f }, envelope);
      // Every note in the tab counts (slide destinations too); dead notes have no pitch.
      const truthNotes = truth.events.filter((e) => !e.tech.includes('dead'));
      const acc = noteAccuracy(truthNotes, r.notes);
      console.log(`${f}: P ${acc.precision.toFixed(2)} R ${acc.recall.toFixed(2)} F1 ${acc.f1.toFixed(2)} (${acc.matched}/${acc.truth}, ${acc.detected} detected) @ ${r.bpm} bpm`);
      expect(acc.f1).toBeGreaterThanOrEqual(0.9);

      const built = buildTimeline(loadAlphaTex(r.alphaTex), { ...DEFAULT_BUILD, trackIndex: 0 });
      expect(built.warnings).toEqual([]);
      expect(validateTimeline(built.timeline)).toEqual([]);
      // Every written note has a confidence.
      for (const e of built.timeline.events) expect(r.noteConfidence[refKey(e.ref!)]).toBeGreaterThan(0);
      // Same pitch sequence as the cleaned detections.
      expect(built.timeline.events.map((e) => e.midi).sort()).toEqual(r.notes.map((n) => n.midi).sort());
    });
  }
});
