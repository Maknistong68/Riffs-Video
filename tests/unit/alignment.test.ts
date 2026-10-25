import { describe, expect, it } from 'vitest';
import { streamAlignment } from '../../src/export/alignment';

const FS = 48_000;
function signal(n: number): Float32Array {
  const x = new Float32Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const env = Math.exp(-((i % 12000) / 3000));
    x[i] = env * (Math.sin(i * 0.05) + 0.3 * ((seed / 0x7fffffff) * 2 - 1));
  }
  return x;
}
const shift = (x: Float32Array, k: number) => Float32Array.from({ length: x.length }, (_, i) => x[i - k] ?? 0);

describe('streamAlignment', () => {
  const x = signal(FS * 2);
  it('identical streams: zero offset, full correlation', () => {
    const a = streamAlignment(x, x, FS);
    expect(a.offsetMs).toBe(0);
    expect(a.correlation).toBeGreaterThan(0.999);
    expect(a.ok).toBe(true);
  });
  it('measures a late stream to the sample and fails beyond 2 ms', () => {
    const late = streamAlignment(shift(x, 48 * 5), x, FS);
    expect(late.offsetMs).toBeCloseTo(5, 3);
    expect(late.ok).toBe(false);
    expect(streamAlignment(shift(x, 24), x, FS).ok).toBe(true);
  });
  it('a different signal does not align', () => {
    const other = signal(FS * 2).map((v, i) => v * Math.sin(i * 0.001) + Math.cos(i * 0.31) * 0.5);
    expect(streamAlignment(other, x, FS).correlation).toBeLessThan(0.8);
  });
});
