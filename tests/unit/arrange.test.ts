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

describe('phase 6 arrangements', () => {
  it('hook-first: one full-speed pass, then the teach passes, then full speed', () => {
    const { timeline: t } = arrange('01-pentatonic-run.atex', { slowMo: true, loopHardest: false, hookFirst: true } as never);
    expect(validateTimeline(t)).toEqual([]);
    expect(t.sections!.map((s) => s.label)).toEqual(['Hook · full speed', 'Slow · 50%', 'Slow · 75%', 'Full speed']);
    const len = (i: number) => t.sections![i]!.endMs - t.sections![i]!.startMs;
    expect(len(0)).toBeCloseTo(len(3), 3);
  });

  it('speed-up ending: full speed, then 125 % and 150 % — same notes, shorter passes', () => {
    const { timeline: t } = arrange('01-pentatonic-run.atex', { slowMo: false, loopHardest: false, hookFirst: true, speedUp: true } as never);
    expect(validateTimeline(t)).toEqual([]);
    expect(t.sections!.map((s) => s.label)).toEqual(['Hook · full speed', 'Full speed', 'Faster · 125%', 'Faster · 150%']);
    const len = (i: number) => t.sections![i]!.endMs - t.sections![i]!.startMs;
    const per = (i: number) => t.events.filter((e) => e.startMs >= t.sections![i]!.startMs && e.startMs < t.sections![i]!.endMs).length;
    expect(per(2)).toBe(per(1));
    expect(per(3)).toBe(per(1));
    expect(len(2)).toBeLessThan(len(1));
    expect(len(3)).toBeLessThan(len(2));
  });

  it('same riff in 3 positions: identical pitches, different strings/frets, one pass each', () => {
    const { timeline: t, warnings } = arrange('01-pentatonic-run.atex', { slowMo: false, loopHardest: false, positions: true } as never);
    expect(validateTimeline(t)).toEqual([]);
    const secs = t.sections!;
    expect(secs.length).toBeGreaterThanOrEqual(2);
    expect(secs.length).toBeLessThanOrEqual(3);
    expect(secs.some((s) => s.label.startsWith('As written'))).toBe(true);
    const inSec = (i: number) => t.events.filter((e) => e.startMs >= secs[i]!.startMs - 0.5 && e.startMs < secs[i]!.endMs);
    const pitches = (i: number) => inSec(i).map((e) => e.midi);
    const places = (i: number) => inSec(i).map((e) => `${e.stringIdx}:${e.fret}`).join();
    for (let i = 1; i < secs.length; i++) {
      expect(pitches(i)).toEqual(pitches(0));
      expect(places(i)).not.toEqual(places(0));
    }
    // Positions move up the neck in order and stay playable (4-fret hand span, per chord).
    const meanFret = (i: number) => { const f = inSec(i).filter((e) => e.fret > 0).map((e) => e.fret); return f.reduce((a, b) => a + b, 0) / f.length; };
    for (let i = 1; i < secs.length; i++) expect(meanFret(i)).toBeGreaterThan(meanFret(i - 1));
    expect(warnings.filter((w) => /error|could not/i.test(w))).toEqual([]);
  });

  it('bar range: only those bars, at their own times, for every pass', () => {
    const full = arrange('03-repeats.atex', NO_TEACH).timeline;
    const part = arrange('03-repeats.atex', { slowMo: true, loopHardest: true, range: { fromBar: 1, toBar: 1 } } as never).timeline;
    expect(validateTimeline(part)).toEqual([]);
    expect(new Set(part.events.map((e) => e.ref!.bar))).toEqual(new Set([1]));
    expect(full.events.some((e) => e.ref!.bar !== 1)).toBe(true);
    // the loop is the (only) bar of the part
    expect(part.sections!.filter((s) => s.label.startsWith('Loop')).every((s) => s.label.endsWith('bar 2'))).toBe(true);
  });

  it('bar range: audio plays only the part (onsets match the part timeline)', () => {
    const arr = arrange('03-repeats.atex', { slowMo: false, loopHardest: false, range: { fromBar: 2, toBar: 2 } } as never);
    const t = arr.timeline;
    const mono = toMono(renderArrangement(arr, { trackIndex: 0, sampleRate: 48_000, soundFont, totalSamples: msToSample(t.durationMs) }), 2);
    const onsets = detectOnsets(mono, 48_000);
    const expected = [...new Set(t.events.filter((e) => !e.legato).map((e) => e.startMs))];
    for (const ms of expected) expect(Math.min(...onsets.map((o) => Math.abs(o - ms)))).toBeLessThan(8);
    expect(onsets.filter((o) => expected.every((ms) => Math.abs(o - ms) > 40)).length).toBeLessThanOrEqual(1);
  });
});
