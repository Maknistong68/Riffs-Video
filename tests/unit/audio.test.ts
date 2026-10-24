import { describe, expect, it } from 'vitest';
import { midiToHz, renderBeeps } from './helpers/beeps';
import { detectOnsets } from '../../src/audio/onsets';
import { AUDIO_SAMPLE_RATE, frameCount, samplesForFrames } from '../../src/engine/time';
import { demoTimeline } from './helpers/demoTimeline';

const t = demoTimeline();
const total = samplesForFrames(frameCount(t.durationMs, 30), 30);
const pcm = renderBeeps(t, total, AUDIO_SAMPLE_RATE);

describe('beeps', () => {
  it('A4 = 440 Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(40)).toBeCloseTo(82.41, 1);
  });

  it('is silent before the first note and starts exactly on its sample', () => {
    const first = 48 * t.events[0]!.startMs;
    for (let i = 0; i < first; i++) expect(pcm[i]).toBe(0);
    let nonZero = -1;
    for (let i = first; i < first + 200; i++) if (pcm[i] !== 0) { nonZero = i; break; }
    expect(nonZero - first).toBeLessThanOrEqual(1);
  });

  it('peaks at -7 dBFS and never clips', () => {
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.45, 3);
  });
});

describe('onset detection', () => {
  const nearest = (onsets: number[], ms: number) => Math.min(...onsets.map((o) => Math.abs(o - ms)));

  it('finds every beep within 5 ms', () => {
    const onsets = detectOnsets(pcm, AUDIO_SAMPLE_RATE);
    for (const e of t.events) expect(nearest(onsets, e.startMs)).toBeLessThan(5);
  });

  it('a 150 ms shifted track no longer lines up', () => {
    const shifted = new Float32Array(pcm.length);
    shifted.set(pcm.subarray(0, pcm.length - 7200), 7200);
    const onsets = detectOnsets(shifted, AUDIO_SAMPLE_RATE);
    for (const e of t.events) expect(nearest(onsets, e.startMs)).toBeGreaterThan(1000 / 30);
  });

  it('silence has no onsets', () => {
    expect(detectOnsets(new Float32Array(48_000), AUDIO_SAMPLE_RATE)).toEqual([]);
  });
});

describe('firstAbove', () => {
  it('finds the first sample over the threshold', async () => {
    const { firstAbove } = await import('../../src/export/encoderLatency');
    expect(firstAbove(new Float32Array([0, 0.05, -0.2, 0.5]), 0.1)).toBe(2);
    expect(firstAbove(new Float32Array([0, 0.05]), 0.1)).toBe(-1);
  });
});
