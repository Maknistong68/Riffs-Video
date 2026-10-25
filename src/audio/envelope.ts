/** RMS envelope (one value per `hopMs`) and attack strength: how much louder it gets at `ms`. */
export const ENVELOPE_HOP_MS = 5;

export function rmsEnvelope(pcm: Float32Array, sampleRate: number, hopMs = ENVELOPE_HOP_MS): Float32Array {
  const hop = Math.max(1, Math.round((hopMs * sampleRate) / 1000));
  const out = new Float32Array(Math.floor(pcm.length / hop));
  for (let h = 0; h < out.length; h++) {
    let s = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) s += pcm[i]! * pcm[i]!;
    out[h] = Math.sqrt(s / hop);
  }
  return out;
}

/** Peak RMS in the 40 ms after `ms` over mean RMS 10–50 ms before it. A pick attack is ≳ 1.4. */
export function attackRatio(env: ArrayLike<number>, ms: number, hopMs = ENVELOPE_HOP_MS): number {
  const at = Math.round(ms / hopMs);
  let peak = 0;
  for (let k = at; k < at + Math.round(40 / hopMs) && k < env.length; k++) peak = Math.max(peak, env[k]!);
  let sum = 0;
  let n = 0;
  for (let k = at - Math.round(50 / hopMs); k < at - Math.round(10 / hopMs); k++) {
    if (k < 0) continue;
    sum += env[k]!;
    n++;
  }
  const before = n ? sum / n : 0;
  return before > 1e-6 ? peak / before : peak > 1e-4 ? 10 : 1;
}
