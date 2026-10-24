/** Windowed-sinc resampler (offline, mono). Used to feed Basic Pitch (22 050 Hz). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array<ArrayBuffer> {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = toRate / fromRate;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio); // low-pass at the lower Nyquist
  const HALF = 16; // taps each side (in input samples, scaled by cutoff)
  const width = HALF / cutoff;
  for (let i = 0; i < outLen; i++) {
    const centre = i / ratio;
    const lo = Math.max(0, Math.ceil(centre - width));
    const hi = Math.min(input.length - 1, Math.floor(centre + width));
    let acc = 0;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const x = (j - centre) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (j - centre)) / (width + 1));
      const k = sinc * w;
      acc += input[j]! * k;
      norm += k;
    }
    out[i] = norm !== 0 ? acc / norm : 0;
  }
  return out;
}
