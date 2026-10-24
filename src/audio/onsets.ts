import { sampleToMs } from '../engine/time';

export type OnsetOptions = {
  /** Hop size of the energy envelope in ms. */
  hopMs?: number;
  /** Threshold as a fraction of the loudest hop's RMS. */
  relThreshold?: number;
  /** Minimum gap between two onsets. */
  refractoryMs?: number;
};

/**
 * Simple energy-rise onset detector (Phase 0 Sync check; Phase 1 replaces it with Basic Pitch).
 * Returns onset times in ms. Accurate to about one hop for percussive / beep signals.
 */
export function detectOnsets(pcm: Float32Array, sampleRate: number, opts: OnsetOptions = {}): number[] {
  const hopMs = opts.hopMs ?? 1;
  const hop = Math.max(1, Math.round((hopMs * sampleRate) / 1000));
  const nHops = Math.floor(pcm.length / hop);
  const rms = new Float32Array(nHops);
  let max = 0;
  for (let h = 0; h < nHops; h++) {
    let sum = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) sum += pcm[i]! * pcm[i]!;
    rms[h] = Math.sqrt(sum / hop);
    max = Math.max(max, rms[h]!);
  }
  if (max === 0) return [];
  const threshold = max * (opts.relThreshold ?? 0.08);
  const refractoryHops = Math.round((opts.refractoryMs ?? 60) / hopMs);
  const lookback = Math.round(15 / hopMs);

  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let h = 1; h < nHops; h++) {
    if (rms[h]! < threshold || rms[h - 1]! >= threshold) continue;
    if (h - lastOnset < refractoryHops) continue;
    // Must be a genuine rise from (near) silence, not the tail of a previous note wobbling.
    let before = 0;
    for (let k = Math.max(0, h - lookback); k < h; k++) before = Math.max(before, rms[k]!);
    if (before > threshold) continue;
    // Refine to the first sample above a small absolute floor within the hop window before.
    const floor = threshold * 0.25;
    let s = h * hop;
    const minS = Math.max(0, (h - 3) * hop);
    while (s > minS && Math.abs(pcm[s - 1]!) > floor) s--;
    onsets.push(sampleToMs(s, sampleRate));
    lastOnset = h;
  }
  return onsets;
}
