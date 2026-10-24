import { describe, expect, it } from 'vitest';
import { midiToHz, renderBeeps } from '../../src/audio/beeps';
import { detectOnsets } from '../../src/audio/onsets';
import { AUDIO_SAMPLE_RATE, frameCount, samplesForFrames } from '../../src/engine/time';
import { matchOnsets } from '../../src/export/syncCheck';
import { demoTimeline } from '../../src/spike/demoTimeline';

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

describe('onset detection + matching', () => {
  it('finds every beep within 2 ms', () => {
    const onsets = detectOnsets(pcm, AUDIO_SAMPLE_RATE);
    expect(onsets).toHaveLength(8);
    const { matches, extraOnsets } = matchOnsets(t, onsets, 1000 / 30);
    expect(extraOnsets).toEqual([]);
    for (const m of matches) {
      expect(m.ok).toBe(true);
      expect(Math.abs(m.errorMs!)).toBeLessThan(2);
    }
  });

  it('reports a shifted audio track as out of sync', () => {
    const shifted = new Float32Array(pcm.length);
    shifted.set(pcm.subarray(0, pcm.length - 2400), 2400); // +50 ms
    const { matches } = matchOnsets(t, detectOnsets(shifted, AUDIO_SAMPLE_RATE), 1000 / 30);
    expect(matches.every((m) => !m.ok)).toBe(true);
  });

  it('chord notes share one onset', () => {
    const chord = structuredClone(t);
    chord.events = [
      { ...t.events[0]!, id: 'a', chordId: 'c1' },
      { ...t.events[2]!, id: 'b', startMs: t.events[0]!.startMs, chordId: 'c1' },
    ];
    const { matches, extraOnsets } = matchOnsets(chord, [1000.5], 33);
    expect(matches.every((m) => m.ok)).toBe(true);
    expect(extraOnsets).toEqual([]);
  });
});

describe('firstAbove', () => {
  it('finds the first sample over the threshold', async () => {
    const { firstAbove } = await import('../../src/export/encoderLatency');
    expect(firstAbove(new Float32Array([0, 0.05, -0.2, 0.5]), 0.1)).toBe(2);
    expect(firstAbove(new Float32Array([0, 0.05]), 0.1)).toBe(-1);
  });
});
