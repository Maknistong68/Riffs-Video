import { describe, expect, it } from 'vitest';
import { integratedLoudness, normaliseLoudness, truePeakDb } from '../../src/audio/mix';

const SR = 48_000;
function sine(amp: number, hz: number, sec: number, channels = 2): Float32Array {
  const n = SR * sec;
  const out = new Float32Array(n * channels);
  for (let c = 0; c < channels; c++) for (let i = 0; i < n; i++) out[c * n + i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

describe('BS.1770 loudness', () => {
  it('997 Hz full-scale sine in one channel reads -3.01 LUFS (spec reference)', () => {
    const n = SR * 5;
    const x = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 997 * i) / SR);
    expect(integratedLoudness(x, 2, SR)).toBeCloseTo(-3.01, 1);
  });

  it('-20 dBFS stereo sine reads about -20 LUFS', () => {
    expect(integratedLoudness(sine(0.1, 997, 5), 2, SR)).toBeCloseTo(-20, 0);
  });

  it('silence is -Infinity', () => {
    expect(integratedLoudness(new Float32Array(SR * 2), 2, SR)).toBe(-Infinity);
  });
});

describe('true peak', () => {
  it('catches inter-sample peaks above the sample peak', () => {
    // fs/4 sine with 45° phase: samples at ±0.707·A, real peak A.
    const n = 4800;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    expect(truePeakDb(x)).toBeGreaterThan(-0.5);
    expect(20 * Math.log10(Math.max(...x))).toBeLessThan(-2.9);
  });
});

describe('normalise', () => {
  it('reaches -14 LUFS when headroom allows', () => {
    const x = sine(0.05, 440, 4);
    const r = normaliseLoudness(x, 2, SR);
    expect(r.lufsAfter).toBeCloseTo(-14, 1);
    expect(integratedLoudness(x, 2, SR)).toBeCloseTo(-14, 1);
    expect(r.truePeakAfter).toBeLessThanOrEqual(-1 + 1e-9);
  });

  it('keeps true peak ≤ -1 dBTP for peaky material (stays quieter than target)', () => {
    const x = new Float32Array(SR * 4 * 2);
    for (let i = 0; i < x.length; i += 4800) x[i] = 0.5; // sparse clicks: high peak, low loudness
    const r = normaliseLoudness(x, 2, SR);
    expect(r.truePeakAfter).toBeCloseTo(-1, 3);
    expect(truePeakDb(x)).toBeLessThanOrEqual(-0.99);
  });
});
