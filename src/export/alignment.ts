/**
 * Stream alignment: is the audio decoded from the MP4 the audio we encoded, at the same time?
 * Normalised cross-correlation over the loudest stretches, then the correlation coefficient of
 * the whole signal at the best lag. Pure function (used by the Sync Report).
 */

export type Alignment = { offsetMs: number; correlation: number; ok: boolean };

export const MAX_ALIGN_OFFSET_MS = 2;
export const MIN_ALIGN_CORRELATION = 0.8;
const SEARCH_MS = 20;
const WINDOW_MS = 200;
const WINDOWS = 4;

function corrAt(a: Float32Array, b: Float32Array, lag: number, from: number, len: number): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = from; i < from + len; i++) {
    const j = i + lag;
    if (j < 0 || j >= b.length) continue;
    const x = a[i]!, y = b[j]!;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** `decoded` sample i corresponds to `intended` sample i + lag; offsetMs > 0: decoded is late. */
export function streamAlignment(decoded: Float32Array, intended: Float32Array, sampleRate: number): Alignment {
  const win = Math.round((WINDOW_MS * sampleRate) / 1000);
  const maxLag = Math.round((SEARCH_MS * sampleRate) / 1000);
  const n = Math.min(decoded.length, intended.length);
  const blocks: { from: number; energy: number }[] = [];
  for (let from = maxLag; from + win + maxLag <= n; from += win) {
    let e = 0;
    for (let i = from; i < from + win; i++) e += intended[i]! * intended[i]!;
    blocks.push({ from, energy: e });
  }
  const loud = blocks.filter((b) => b.energy > 0).sort((a, b) => b.energy - a.energy || a.from - b.from).slice(0, WINDOWS);
  if (loud.length === 0) return { offsetMs: 0, correlation: 0, ok: false };
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (const b of loud) sum += corrAt(intended, decoded, lag, b.from, win);
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  const correlation = corrAt(intended, decoded, bestLag, 0, n - Math.max(0, bestLag));
  const offsetMs = (bestLag * 1000) / sampleRate;
  return { offsetMs, correlation, ok: Math.abs(offsetMs) <= MAX_ALIGN_OFFSET_MS && correlation >= MIN_ALIGN_CORRELATION };
}
