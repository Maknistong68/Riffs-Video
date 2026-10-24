import { sampleToMs } from '../engine/time';
import { fft, hann } from './fft';

export type OnsetOptions = {
  /** FFT size (power of two). */
  windowSize?: number;
  /** Hop between analysis frames, in samples. */
  hop?: number;
  /** Peak must exceed the local median by this factor of the global max flux. */
  delta?: number;
  /** Minimum gap between onsets. */
  minGapMs?: number;
};

/**
 * A Hann-windowed flux peak lands a little before the true attack. Measured on the alphaTab
 * synth across the golden riffs (≈ 4 ms at N = 1024 / 48 kHz); expressed relative to N.
 */
const BIAS_FRACTION_OF_WINDOW = 3 / 16;

/**
 * Spectral-flux onset detector (log-magnitude, half-wave rectified), with adaptive
 * median threshold and peak picking. Works for legato guitar notes where energy never
 * returns to silence. Typical error ±4 ms. Returns onset times in ms.
 */
export function detectOnsets(pcm: Float32Array, sampleRate: number, opts: OnsetOptions = {}): number[] {
  const N = opts.windowSize ?? 1024;
  const hop = opts.hop ?? 128;
  const win = hann(N);
  const nFrames = Math.max(0, Math.floor((pcm.length - N) / hop) + 1);
  if (nFrames < 3) return [];
  const bins = N / 2;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);
  const flux = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = pcm[off + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      if (f > 0) sum += Math.max(0, cur[k]! - prev[k]!);
    }
    flux[f] = sum;
    [prev, cur] = [cur, prev];
  }

  let maxFlux = 0;
  for (const v of flux) maxFlux = Math.max(maxFlux, v);
  if (maxFlux === 0) return [];
  const delta = (opts.delta ?? 0.08) * maxFlux;
  const minGap = Math.round(((opts.minGapMs ?? 45) * sampleRate) / 1000 / hop);
  const medW = Math.round((0.1 * sampleRate) / hop); // ±100 ms
  const peakW = Math.max(1, Math.round((0.02 * sampleRate) / hop)); // local max over ±20 ms

  const peaks: number[] = [];
  const tmp: number[] = [];
  for (let f = 1; f < nFrames - 1; f++) {
    const v = flux[f]!;
    let isMax = true;
    for (let k = Math.max(0, f - peakW); k <= Math.min(nFrames - 1, f + peakW); k++) {
      if (flux[k]! > v || (flux[k] === v && k < f)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    tmp.length = 0;
    for (let k = Math.max(0, f - medW); k <= Math.min(nFrames - 1, f + medW); k++) tmp.push(flux[k]!);
    tmp.sort((a, b) => a - b);
    const median = tmp[tmp.length >> 1]!;
    if (v < median + delta) continue;
    if (peaks.length > 0 && f - peaks[peaks.length - 1]! < minGap) continue;
    peaks.push(f);
  }

  // Frame f's window is centred at f*hop + N/2; correct the measured flux-peak bias.
  const bias = N * BIAS_FRACTION_OF_WINDOW;
  return peaks.map((f) => sampleToMs(f * hop + N / 2 + bias, sampleRate));
}
