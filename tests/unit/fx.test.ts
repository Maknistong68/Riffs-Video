import { describe, expect, it } from 'vitest';
import { applyTone, biquad, runBiquad } from '../../src/audio/fx';
import { TONE_PRESETS, tonePreset, toneForSkin, programOf } from '../../src/audio/tone';

const FS = 48_000;

/** Planar stereo: a plucked 110 Hz note at `atSec`, decaying, then silence. */
function pluck(seconds: number, atSec = 0.1, hz = 110): Float32Array {
  const n = Math.round(seconds * FS);
  const out = new Float32Array(n * 2);
  for (let i = Math.round(atSec * FS); i < n; i++) {
    const t = i / FS - atSec;
    const v = 0.3 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t));
    out[i] = v;
    out[n + i] = v;
  }
  return out;
}

/** Energy of a single frequency (Goertzel) over a window, mono = left channel. */
function energyAt(x: Float32Array, from: number, len: number, hz: number): number {
  const k = (2 * Math.cos((2 * Math.PI * hz) / FS));
  let s1 = 0, s2 = 0;
  for (let i = from; i < from + len; i++) {
    const s0 = x[i]! + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

describe('tone presets', () => {
  it('every preset is complete and maps to a GM guitar/bass program', () => {
    for (const p of TONE_PRESETS) {
      const t = tonePreset(p.id);
      expect(t.preset).toBe(p.id);
      for (const k of ['compressor', 'drive', 'amp', 'chorus', 'delay', 'reverb'] as const) expect(typeof t[k].on).toBe('boolean');
      expect([24, 25, 26, 27, 33]).toContain(programOf(t.instrument));
    }
  });
  it('guitar models get a matching default tone', () => {
    expect(toneForSkin('acoustic').instrument).toBe('acoustic');
    expect(toneForSkin('classical').instrument).toBe('nylon');
    expect(toneForSkin('bass4').instrument).toBe('bass');
    expect(toneForSkin('strat').instrument).toBe('electric');
  });
  it('presets are independent copies', () => {
    const a = tonePreset('rock');
    a.drive.gain = 0;
    expect(tonePreset('rock').drive.gain).not.toBe(0);
  });
});

describe('applyTone', () => {
  it('is deterministic and keeps the length', () => {
    const x = pluck(1);
    for (const p of TONE_PRESETS) {
      const a = applyTone(x, FS, tonePreset(p.id));
      const b = applyTone(x, FS, tonePreset(p.id));
      expect(a.length).toBe(x.length);
      expect(a).toEqual(b);
      expect(a.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('keeps the lead-in silent: nothing sounds before the first note', () => {
    const x = pluck(1, 0.5);
    for (const p of TONE_PRESETS) {
      const y = applyTone(x, FS, tonePreset(p.id));
      let maxBefore = 0;
      for (let i = 0; i < 0.5 * FS; i++) maxBefore = Math.max(maxBefore, Math.abs(y[i]!));
      expect(maxBefore, p.id).toBeLessThan(1e-6);
    }
  });

  it('all-silent input stays silent', () => {
    expect(applyTone(new Float32Array(2000), FS, tonePreset('metal')).every((v) => v === 0)).toBe(true);
  });

  it('distortion adds harmonics the clean tone does not have', () => {
    const x = pluck(1, 0.1, 110);
    const clean = applyTone(x, FS, tonePreset('clean'));
    const dist = applyTone(x, FS, tonePreset('metal'));
    const ratio = (y: Float32Array) => energyAt(y, 6000, 9600, 330) / energyAt(y, 6000, 9600, 110);
    expect(ratio(dist)).toBeGreaterThan(ratio(clean) * 3);
  });

  it('the attack stays where the note is (no latency added to onsets)', () => {
    const x = pluck(1, 0.3);
    for (const id of ['clean', 'rock', 'metal', 'acoustic', 'lead']) {
      const y = applyTone(x, FS, tonePreset(id));
      const peak = y.subarray(0, x.length / 2).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const first = y.findIndex((v) => Math.abs(v) > peak * 0.1);
      expect(Math.abs(first / FS - 0.3) * 1000, id).toBeLessThan(2);
    }
  });

  it('delay repeats the note after the delay time', () => {
    const n = FS;
    const click = new Float32Array(n * 2);
    for (let i = 4800; i < 4848; i++) click[i] = click[n + i] = Math.sin(((i - 4800) / 48) * Math.PI);
    const t = tonePreset('clean');
    t.compressor.on = false;
    t.amp.on = false;
    t.reverb.on = false;
    t.delay = { on: true, timeMs: 250, feedback: 0.3, mix: 0.5 };
    const y = applyTone(click, FS, t);
    const at = (ms: number) => y.subarray(4800 + (ms * FS) / 1000 - 48, 4800 + (ms * FS) / 1000 + 96).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(at(250)).toBeGreaterThan(0.05);
    expect(at(125)).toBeLessThan(0.01);
  });

  it('reverb leaves a tail after the note stops', () => {
    const x = pluck(1.5, 0.1);
    for (let i = Math.round(0.4 * FS); i < x.length / 2; i++) x[i] = x[x.length / 2 + i] = 0;
    const t = tonePreset('acoustic');
    const y = applyTone(x, FS, t);
    const tail = y.subarray(Math.round(0.6 * FS), Math.round(0.8 * FS)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(tail).toBeGreaterThan(0.002);
  });

  it('the amp cabinet rolls off fizz above ~6 kHz', () => {
    const n = FS;
    const x = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) x[i] = x[n + i] = 0.2 * Math.sin((2 * Math.PI * 300 * i) / FS) + 0.2 * Math.sin((2 * Math.PI * 9000 * i) / FS);
    const t = tonePreset('clean');
    t.compressor.on = false;
    t.reverb.on = false;
    t.amp.gain = 0;
    const y = applyTone(x, FS, t);
    const ratio = energyAt(y, 4800, 9600, 9000) / energyAt(y, 4800, 9600, 300);
    expect(ratio).toBeLessThan(0.05);
  });
});

describe('biquads', () => {
  it('lowpass passes DC and blocks Nyquist', () => {
    const x = new Float32Array(4000).fill(1);
    runBiquad(x, biquad.lowpass(FS, 1000));
    expect(x[3999]).toBeCloseTo(1, 3);
    const y = Float32Array.from({ length: 4000 }, (_, i) => (i % 2 ? 1 : -1));
    runBiquad(y, biquad.lowpass(FS, 1000));
    expect(Math.abs(y[3999]!)).toBeLessThan(1e-3);
  });
});
