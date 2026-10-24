/**
 * Loudness (ITU-R BS.1770-4 / EBU R128) and true-peak, plus normalisation to the brief's
 * target: -14 LUFS integrated, true peak ≤ -1 dBTP (P20). Pure functions on planar PCM.
 */

export const TARGET_LUFS = -14;
export const MAX_TRUE_PEAK_DBTP = -1;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** K-weighting filter pair (pre-filter shelf + RLB high-pass) for any sample rate. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Coefficients derived as in libebur128 / pyloudnorm from the analogue prototypes.
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Integrated loudness in LUFS (gated, 400 ms blocks, 75 % overlap). -Infinity for silence. */
export function integratedLoudness(planar: Float32Array, channels: number, sampleRate: number): number {
  const n = planar.length / channels;
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted: Float32Array[] = [];
  for (let c = 0; c < channels; c++) weighted.push(filter(filter(planar.subarray(c * n, (c + 1) * n), shelf), hp));

  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const powers: number[] = [];
  if (n < block) {
    // Shorter than one gating block: use the whole signal as a single block.
    powers.push(blockPower(weighted, 0, n));
  } else {
    for (let s = 0; s + block <= n; s += step) powers.push(blockPower(weighted, s, block));
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const absGated = powers.filter((p) => lufs(p) > -70);
  if (absGated.length === 0) return -Infinity;
  const relThreshold = lufs(mean(absGated)) - 10;
  const relGated = absGated.filter((p) => lufs(p) > relThreshold);
  return lufs(mean(relGated));
}

function blockPower(ch: Float32Array[], start: number, len: number): number {
  let sum = 0;
  for (const x of ch) {
    let s = 0;
    for (let i = start; i < start + len; i++) s += x[i]! * x[i]!;
    sum += s / len; // channel weight 1.0 for L/R
  }
  return sum;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/** 4× oversampled true peak (windowed-sinc interpolation), in dBTP. */
export function truePeakDb(planar: Float32Array): number {
  const OS = 4;
  const TAPS = 12; // per phase, each side
  const kernels: Float32Array[] = [];
  for (let p = 1; p < OS; p++) {
    const k = new Float32Array(2 * TAPS);
    for (let t = -TAPS + 1; t <= TAPS; t++) {
      const x = t - p / OS;
      const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 1));
      k[t + TAPS - 1] = sinc * w;
    }
    kernels.push(k);
  }
  let peak = 0;
  for (let i = 0; i < planar.length; i++) {
    peak = Math.max(peak, Math.abs(planar[i]!));
    for (const k of kernels) {
      let v = 0;
      for (let j = 0; j < k.length; j++) {
        const idx = i - TAPS + 1 + j;
        if (idx >= 0 && idx < planar.length) v += planar[idx]! * k[j]!;
      }
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export type NormaliseResult = { gainDb: number; lufsBefore: number; lufsAfter: number; truePeakAfter: number };

/**
 * Scale to -14 LUFS; if that would push true peak above -1 dBTP, use the largest gain
 * that keeps the peak at -1 dBTP instead (quieter, never clipped). In place.
 */
export function normaliseLoudness(planar: Float32Array, channels: number, sampleRate: number): NormaliseResult {
  const before = integratedLoudness(planar, channels, sampleRate);
  if (!Number.isFinite(before)) return { gainDb: 0, lufsBefore: before, lufsAfter: before, truePeakAfter: -Infinity };
  const tp = truePeakDb(planar);
  const gainDb = Math.min(TARGET_LUFS - before, MAX_TRUE_PEAK_DBTP - tp);
  const g = 10 ** (gainDb / 20);
  for (let i = 0; i < planar.length; i++) planar[i]! *= g;
  return { gainDb, lufsBefore: before, lufsAfter: before + gainDb, truePeakAfter: tp + gainDb };
}
