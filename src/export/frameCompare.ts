/** PSNR (dB) between two RGBA buffers, RGB channels only. Infinity when identical. */
export function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) throw new Error('Image sizes differ');
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c]! - b[i + c]!;
      se += d * d;
    }
    n += 3;
  }
  if (se === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / (se / n));
}

/** Frames spread over the video, preferring note onsets (where errors would show). */
export function pickSampleFrames(onsetFrames: readonly number[], totalFrames: number, count = 5): number[] {
  const pool = onsetFrames.length >= count ? onsetFrames : [...onsetFrames, 0, totalFrames - 1];
  const out = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (pool.length - 1)) / Math.max(1, count - 1));
    const f = pool[idx];
    if (f !== undefined) out.add(Math.min(totalFrames - 1, Math.max(0, f)));
  }
  return [...out].sort((x, y) => x - y);
}
