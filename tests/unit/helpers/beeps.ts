import { msToSample } from '../../../src/engine/time';
import type { Timeline } from '../../../src/engine/timeline';

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const ATTACK_MS = 2;
const RELEASE_MS = 6;
const MAX_BEEP_MS = 240;
const DECAY_TAU_MS = 110;
const PEAK = 0.45;

/**
 * Phase 0 stand-in for the synth: one sine beep (+ a little 2nd harmonic) per note,
 * starting exactly at msToSample(event.startMs). Mono, `totalSamples` long.
 */
export function renderBeeps(t: Timeline, totalSamples: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(totalSamples);
  for (const e of t.events) {
    const start = msToSample(e.startMs, sampleRate);
    const lenMs = Math.min(e.durationMs, MAX_BEEP_MS);
    const len = msToSample(lenMs, sampleRate);
    const hz = midiToHz(e.midi);
    const attack = msToSample(ATTACK_MS, sampleRate);
    const release = msToSample(RELEASE_MS, sampleRate);
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      const tSec = i / sampleRate;
      let env = Math.exp(-(tSec * 1000) / DECAY_TAU_MS);
      if (i < attack) env *= i / attack;
      if (i > len - release) env *= (len - i) / release;
      const w = 2 * Math.PI * hz * tSec;
      out[start + i]! += env * (0.8 * Math.sin(w) + 0.2 * Math.sin(2 * w));
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < out.length; i++) out[i]! *= gain;
  return out;
}
