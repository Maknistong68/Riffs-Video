import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectOnsets } from '../../src/audio/onsets';
import { renderArrangement, toMono } from '../../src/audio/synth';
import { buildArrangement, LOOP_COUNT, NO_TEACH, PASS_GAP_MS } from '../../src/engine/arrange';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { msToSample } from '../../src/engine/time';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';

const golden = join(__dirname, '../golden/riffs');
const soundFont = new Uint8Array(readFileSync(join(__dirname, '../../node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2')));
const tex = (f: string) => readFileSync(join(golden, f), 'utf8');
const arrange = (f: string, teach = { slowMo: true, loopHardest: true }) =>
  buildArrangement(() => loadAlphaTex(tex(f)), { trackIndex: 0, leadInMs: 1000, tailMs: 1200, teach });

describe('arrangement timeline', () => {
  it('without teach options equals the plain timeline', () => {
    const plain = buildTimeline(loadAlphaTex(tex('01-pentatonic-run.atex')), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
    const arr = arrange('01-pentatonic-run.atex', NO_TEACH).timeline;
    expect(arr.events.map((e) => [e.id, e.startMs, e.durationMs])).toEqual(plain.events.map((e) => [e.id, e.startMs, e.durationMs]));
    expect(arr.durationMs).toBeCloseTo(plain.durationMs, 6);
  });

  it('slow passes take 2× and 1.33× as long, then the loop, then full speed', () => {
    const { timeline: t } = arrange('01-pentatonic-run.atex');
    expect(validateTimeline(t)).toEqual([]);
    const labels = t.sections!.map((s) => s.label);
    expect(labels).toEqual(['Slow · 50%', 'Slow · 75%', ...[1, 2, 3].map((k) => expect.stringMatching(new RegExp(`^Loop ${k}/${LOOP_COUNT} · bar \\d+$`))), 'Full speed']);
    const len = (i: number) => t.sections![i]!.endMs - t.sections![i]!.startMs;
    expect(len(0) / len(5)).toBeCloseTo(2, 2);
    expect(len(1) / len(5)).toBeCloseTo(4 / 3, 2);
    // gaps between passes, none between loop repetitions
    expect(t.sections![1]!.startMs - t.sections![0]!.endMs).toBeCloseTo(PASS_GAP_MS, 0);
    expect(t.sections![3]!.startMs - t.sections![2]!.endMs).toBeCloseTo(0, 6);
    expect(new Set(t.events.map((e) => e.id)).size).toBe(t.events.length);
  });
});

describe('arranged audio lands exactly on the composite timeline', () => {
  for (const f of readdirSync(golden).filter((x) => x.endsWith('.atex')).sort()) {
    it(f, () => {
      const arr = arrange(f);
      const t = arr.timeline;
      const total = msToSample(t.durationMs);
      const mono = toMono(renderArrangement(arr, { trackIndex: 0, sampleRate: 48_000, soundFont, totalSamples: total }), 2);
      const onsets = detectOnsets(mono, 48_000);
      const expected = [...new Set(t.events.filter((e) => !e.legato).map((e) => e.startMs))];
      for (const ms of expected) {
        expect(Math.min(...onsets.map((o) => Math.abs(o - ms))), `onset near ${ms.toFixed(1)} ms`).toBeLessThan(8);
      }
      // No clicks where a pass/loop is cut: no attack at a section edge unless a note starts there.
      for (const sec of t.sections ?? []) {
        for (const edge of [sec.endMs]) {
          const noteThere = expected.some((ms) => Math.abs(ms - edge) < 20);
          const attack = onsets.some((o) => Math.abs(o - edge) < 15);
          expect(attack && !noteThere, `click at end of ${sec.label} (${edge.toFixed(0)} ms)`).toBe(false);
        }
      }
    }, 60_000);
  }
});
