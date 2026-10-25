/**
 * Pedalboard + amp DSP: compressor → drive → amp (tone stack + cabinet) → chorus → delay → reverb.
 * Pure and deterministic (no randomness, no clocks): the same PCM + ToneSettings always give the
 * same samples, so preview and export sound identical and exports stay reproducible.
 * Input and output are planar stereo [L…, R…]; loudness is normalised afterwards (mix.ts).
 */
import type { DriveType, ToneSettings } from './tone';

type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ audio-EQ-cookbook biquads. */
export const biquad = {
  lowpass(fs: number, f: number, q = Math.SQRT1_2): Coeffs {
    const w = (2 * Math.PI * f) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a;
    return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 };
  },
  highpass(fs: number, f: number, q = Math.SQRT1_2): Coeffs {
    const w = (2 * Math.PI * f) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a;
    return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 };
  },
  peak(fs: number, f: number, q: number, db: number): Coeffs {
    const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a / A;
    return { b0: (1 + a * A) / a0, b1: (-2 * c) / a0, b2: (1 - a * A) / a0, a1: (-2 * c) / a0, a2: (1 - a / A) / a0 };
  },
  lowshelf(fs: number, f: number, db: number): Coeffs {
    const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), s = Math.sin(w), al = (s / 2) * Math.SQRT2, r = 2 * Math.sqrt(A) * al;
    const a0 = A + 1 + (A - 1) * c + r;
    return {
      b0: (A * (A + 1 - (A - 1) * c + r)) / a0,
      b1: (2 * A * (A - 1 - (A + 1) * c)) / a0,
      b2: (A * (A + 1 - (A - 1) * c - r)) / a0,
      a1: (-2 * (A - 1 + (A + 1) * c)) / a0,
      a2: (A + 1 + (A - 1) * c - r) / a0,
    };
  },
  highshelf(fs: number, f: number, db: number): Coeffs {
    const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), s = Math.sin(w), al = (s / 2) * Math.SQRT2, r = 2 * Math.sqrt(A) * al;
    const a0 = A + 1 - (A - 1) * c + r;
    return {
      b0: (A * (A + 1 + (A - 1) * c + r)) / a0,
      b1: (-2 * A * (A - 1 + (A + 1) * c)) / a0,
      b2: (A * (A + 1 + (A - 1) * c - r)) / a0,
      a1: (2 * (A - 1 - (A + 1) * c)) / a0,
      a2: (A + 1 - (A - 1) * c - r) / a0,
    };
  },
};

/** Filter in place (direct form I). */
export function runBiquad(x: Float32Array, f: Coeffs): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    x[i] = yi;
  }
}

function chain(x: Float32Array, filters: Coeffs[]): void {
  for (const f of filters) runBiquad(x, f);
}

function peakAbs(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
}

/** Feed-forward compressor (peak envelope, soft knee-less), evens out picking dynamics. */
export function compress(x: Float32Array, fs: number, amount: number): void {
  const threshold = 10 ** ((-6 - amount * 24) / 20); // relative to the −6 dBFS input reference
  const ratio = 2 + amount * 6;
  const att = Math.exp(-1 / (0.004 * fs));
  const rel = Math.exp(-1 / (0.12 * fs));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    if (env > threshold) {
      const over = env / threshold;
      x[i]! *= over ** (1 / ratio - 1);
    }
  }
  // Make-up gain back to the reference peak.
  const p = peakAbs(x);
  if (p > 0) for (let i = 0; i < x.length; i++) x[i]! *= 0.5 / p;
}

function shape(type: DriveType, v: number): number {
  if (type === 'overdrive') return Math.tanh(v + 0.2) - Math.tanh(0.2); // soft, slightly asymmetric
  if (type === 'distortion') {
    const s = Math.tanh(v);
    return 1.5 * s - 0.5 * s * s * s; // harder knee
  }
  // fuzz: hard, asymmetric clipping
  return v > 0 ? Math.min(v, 1) : Math.max(v, -0.6) / 0.6;
}

/** Drive pedal, 2× oversampled to keep aliasing out of the audible band. */
export function drive(x: Float32Array, fs: number, type: DriveType, gain: number, tone: number): void {
  const pre: Coeffs[] =
    type === 'overdrive'
      ? [biquad.highpass(fs, 220, 0.6), biquad.peak(fs, 720, 0.7, 6)] // mid hump
      : type === 'distortion'
        ? [biquad.highpass(fs, 110, 0.6), biquad.peak(fs, 900, 0.8, 3)]
        : [biquad.highpass(fs, 60, 0.6)];
  chain(x, pre);
  const db = type === 'overdrive' ? 8 + gain * 28 : type === 'distortion' ? 18 + gain * 30 : 24 + gain * 24;
  const k = 10 ** (db / 20);
  const fs2 = fs * 2;
  const up = biquad.lowpass(fs2, Math.min(20_000, fs * 0.42), 0.54);
  const up2 = biquad.lowpass(fs2, Math.min(20_000, fs * 0.42), 1.31);
  // Stateful 4th-order anti-imaging / anti-aliasing filters at 2× rate.
  const st = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const step = (v: number, f: Coeffs, o: number) => {
    const y = f.b0 * v + f.b1 * st[o]! + f.b2 * st[o + 1]! - f.a1 * st[o + 2]! - f.a2 * st[o + 3]!;
    st[o + 1] = st[o]!; st[o] = v; st[o + 3] = st[o + 2]!; st[o + 2] = y;
    return y;
  };
  for (let i = 0; i < x.length; i++) {
    let out = 0;
    for (let ph = 0; ph < 2; ph++) {
      let v = ph === 0 ? x[i]! * 2 : 0;
      v = step(step(v, up, 0), up2, 4);
      v = shape(type, v * k);
      v = step(step(v, up, 8), up2, 12);
      if (ph === 0) out = v;
    }
    x[i] = out;
  }
  const toneHz = 1200 * 2 ** (tone * 3); // 1.2–9.6 kHz
  chain(x, [biquad.lowpass(fs, toneHz, 0.7), biquad.highpass(fs, 25, 0.7)]);
  const p = peakAbs(x);
  if (p > 0) for (let i = 0; i < x.length; i++) x[i]! *= 0.5 / p;
}

/** Amp head (pre-gain + tone stack) into a speaker cabinet. */
export function amp(x: Float32Array, fs: number, a: ToneSettings['amp']): void {
  const k = 1 + a.gain * 6;
  const norm = Math.tanh(k * 0.5);
  for (let i = 0; i < x.length; i++) x[i] = (Math.tanh(k * x[i]!) / norm) * 0.5;
  chain(x, [
    biquad.lowshelf(fs, 120, (a.bass - 0.5) * 24),
    biquad.peak(fs, 650, 0.8, (a.mid - 0.5) * 20),
    biquad.highshelf(fs, 2800, (a.treble - 0.5) * 24),
    // Cabinet: 12" speaker — no deep lows, a low resonance, scooped boxiness, presence, steep top roll-off.
    biquad.highpass(fs, 80, 0.7),
    biquad.peak(fs, 115, 1.2, 3),
    biquad.peak(fs, 420, 1.0, -3),
    biquad.peak(fs, 2200, 1.4, 2.5),
    biquad.lowpass(fs, 5200, 0.7),
    biquad.lowpass(fs, 6000, 0.6),
  ]);
}

/** Stereo chorus: two modulated delay taps, LFOs 90° apart. */
export function chorus(l: Float32Array, r: Float32Array, fs: number, c: ToneSettings['chorus']): void {
  const n = l.length;
  const size = Math.ceil(0.03 * fs) + 4;
  const bufL = new Float32Array(size), bufR = new Float32Array(size);
  const base = 0.011 * fs, depth = (0.001 + c.depth * 0.004) * fs, rate = 0.15 + c.rate * 2.5;
  const wet = c.mix * 0.7, dry = 1 - c.mix * 0.35;
  const read = (buf: Float32Array, w: number, d: number) => {
    const pos = w - d;
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    const a = buf[((i0 % size) + size) % size]!, b = buf[(((i0 + 1) % size) + size) % size]!;
    return a + (b - a) * fr;
  };
  for (let i = 0; i < n; i++) {
    bufL[i % size] = l[i]!;
    bufR[i % size] = r[i]!;
    const ph = (2 * Math.PI * rate * i) / fs;
    const dl = base + depth * 0.5 * (1 + Math.sin(ph));
    const dr = base + depth * 0.5 * (1 + Math.sin(ph + Math.PI / 2));
    const yl = read(bufL, i, dl), yr = read(bufR, i, dr);
    l[i] = dry * l[i]! + wet * yl;
    r[i] = dry * r[i]! + wet * yr;
  }
}

/** Feedback delay with a darkening loop (tape/analogue character), slightly wider on the right. */
export function delay(l: Float32Array, r: Float32Array, fs: number, d: ToneSettings['delay']): void {
  const fb = Math.min(0.85, d.feedback);
  for (const [ch, scale] of [[l, 1], [r, 1.03]] as const) {
    const len = Math.max(1, Math.round((d.timeMs / 1000) * fs * scale));
    const buf = new Float32Array(len);
    const damp = Math.exp((-2 * Math.PI * 3200) / fs);
    let lp = 0;
    for (let i = 0; i < ch.length; i++) {
      const echo = buf[i % len]!;
      lp = (1 - damp) * echo + damp * lp;
      buf[i % len] = ch[i]! + fb * lp;
      ch[i] = ch[i]! + d.mix * lp;
    }
  }
}

// Freeverb tunings at 44.1 kHz (Jezar's public-domain algorithm), scaled to the sample rate.
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

/** Freeverb-style stereo reverb with a short pre-delay. */
export function reverb(l: Float32Array, r: Float32Array, fs: number, v: ToneSettings['reverb']): void {
  const n = l.length;
  const k = fs / 44_100;
  const room = 0.7 + v.size * 0.28;
  const damp = 0.25 + (1 - v.size) * 0.2;
  const pre = Math.round(0.018 * fs);
  const outs = [new Float32Array(n), new Float32Array(n)];
  for (let side = 0; side < 2; side++) {
    const out = outs[side]!;
    const combs = COMBS.map((c) => ({ buf: new Float32Array(Math.round((c + side * SPREAD) * k)), idx: 0, store: 0 }));
    const aps = ALLPASSES.map((a) => ({ buf: new Float32Array(Math.round((a + side * SPREAD) * k)), idx: 0 }));
    for (let i = 0; i < n; i++) {
      const j = i - pre;
      const input = j >= 0 ? (l[j]! + r[j]!) * 0.015 : 0;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.idx]!;
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.idx] = input + c.store * room;
        if (++c.idx >= c.buf.length) c.idx = 0;
        acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.idx]!;
        a.buf[a.idx] = acc + b * 0.5;
        acc = b - acc;
        if (++a.idx >= a.buf.length) a.idx = 0;
      }
      out[i] = acc;
    }
  }
  const wet = v.mix * 3;
  for (let i = 0; i < n; i++) {
    l[i] = l[i]! + wet * outs[0]![i]!;
    r[i] = r[i]! + wet * outs[1]![i]!;
  }
}

/**
 * Run the whole chain. Returns new planar stereo PCM of the same length. The guitar is
 * mono until the stereo effects (as with a real pedalboard and amp).
 */
export function applyTone(planar: Float32Array, fs: number, tone: ToneSettings): Float32Array<ArrayBuffer> {
  const n = planar.length / 2;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (planar[i]! + planar[n + i]!) * 0.5;
  // Fixed input reference (−6 dBFS peak) so drive/compressor behave the same for every riff.
  const p = peakAbs(mono);
  if (p === 0) return new Float32Array(planar.length);
  for (let i = 0; i < n; i++) mono[i]! *= 0.5 / p;

  if (tone.compressor.on) compress(mono, fs, tone.compressor.amount);
  if (tone.drive.on) drive(mono, fs, tone.drive.type, tone.drive.gain, tone.drive.tone);
  if (tone.amp.on) amp(mono, fs, tone.amp);

  const l = mono;
  const r = Float32Array.from(mono);
  if (tone.chorus.on) chorus(l, r, fs, tone.chorus);
  if (tone.delay.on) delay(l, r, fs, tone.delay);
  if (tone.reverb.on) reverb(l, r, fs, tone.reverb);

  // Tails (reverb, echoes) are cut where the video ends: fade instead of clicking.
  const fade = Math.min(n, Math.round(0.03 * fs));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    l[n - 1 - i]! *= g;
    r[n - 1 - i]! *= g;
  }
  const out = new Float32Array(planar.length);
  out.set(l, 0);
  out.set(r, n);
  return out;
}
