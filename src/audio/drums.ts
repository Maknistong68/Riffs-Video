/**
 * Drum backing (phase 6): a small synthesized kit (kick, snare, closed/open hat — generated in code,
 * no sample files) playing a genre pattern on the timeline's own bars and tempo map, so it follows
 * tempo changes, slow-mo passes and loops exactly. Pure and deterministic (seeded noise).
 * Mixed after the guitar's pedals, like the metronome.
 */
import type { Timeline } from '../engine/timeline';

export type DrumPattern = 'none' | 'rock' | 'metal' | 'blues' | 'funk' | 'lofi' | 'folk';
export type DrumSettings = { pattern: DrumPattern; volume: number };
export const DEFAULT_DRUMS: DrumSettings = { pattern: 'none', volume: 0.6 };

export const DRUM_PATTERNS: { id: DrumPattern; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'rock', name: 'Rock' },
  { id: 'metal', name: 'Metal' },
  { id: 'blues', name: 'Blues shuffle' },
  { id: 'funk', name: 'Funk' },
  { id: 'lofi', name: 'Lo-fi' },
  { id: 'folk', name: 'Folk' },
];

type Voice = 'kick' | 'snare' | 'hat' | 'open';
/** Hits per 4/4 bar on a 16-step grid: [step, voice, velocity]. */
type Groove = { hits: [number, Voice, number][]; swing: number; lowpass?: number };

const eighths = (v: number, voice: Voice = 'hat'): [number, Voice, number][] => [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, voice, s % 4 === 0 ? v : v * 0.7]);

const GROOVES: Record<Exclude<DrumPattern, 'none'>, Groove> = {
  rock: { hits: [[0, 'kick', 1], [8, 'kick', 0.9], [10, 'kick', 0.7], [4, 'snare', 1], [12, 'snare', 1], ...eighths(0.55)], swing: 0.5 },
  metal: {
    hits: [...Array.from({ length: 16 }, (_, s) => [s, 'kick', s % 4 === 0 ? 1 : 0.75] as [number, Voice, number]), [4, 'snare', 1], [12, 'snare', 1], ...eighths(0.5)],
    swing: 0.5,
  },
  blues: { hits: [[0, 'kick', 1], [8, 'kick', 0.85], [4, 'snare', 0.9], [12, 'snare', 0.9], ...eighths(0.5)], swing: 0.67 },
  funk: {
    hits: [
      [0, 'kick', 1], [3, 'kick', 0.7], [6, 'kick', 0.8], [10, 'kick', 0.85],
      [4, 'snare', 1], [12, 'snare', 1], [7, 'snare', 0.25], [9, 'snare', 0.25], [15, 'snare', 0.3],
      ...Array.from({ length: 16 }, (_, s) => [s, 'hat', s % 2 === 0 ? 0.5 : 0.3] as [number, Voice, number]),
      [14, 'open', 0.4],
    ],
    swing: 0.5,
  },
  lofi: { hits: [[0, 'kick', 0.9], [7, 'kick', 0.6], [10, 'kick', 0.75], [4, 'snare', 0.75], [12, 'snare', 0.75], ...eighths(0.35)], swing: 0.6, lowpass: 3500 },
  folk: { hits: [[0, 'kick', 0.7], [8, 'kick', 0.6], [4, 'snare', 0.4], [12, 'snare', 0.4], ...eighths(0.3)], swing: 0.5, lowpass: 6000 },
};

function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** One-pole high-pass, in place. */
function highpass(x: Float32Array, fs: number, hz: number): void {
  const a = Math.exp((-2 * Math.PI * hz) / fs);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (py + x[i]! - px);
    px = x[i]!;
    py = y;
    x[i] = y;
  }
}

function lowpass(x: Float32Array, fs: number, hz: number): void {
  const a = Math.exp((-2 * Math.PI * hz) / fs);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = (1 - a) * x[i]! + a * y;
    x[i] = y;
  }
}

export function synthKit(fs: number): Record<Voice, Float32Array> {
  const n = (sec: number) => new Float32Array(Math.round(sec * fs));
  const kick = n(0.4);
  let phase = 0;
  for (let i = 0; i < kick.length; i++) {
    const t = i / fs;
    const f = 45 + 85 * Math.exp(-t / 0.035);
    phase += (2 * Math.PI * f) / fs;
    kick[i] = Math.sin(phase) * Math.exp(-t / 0.14) + (t < 0.004 ? 0.4 * Math.sin(2 * Math.PI * 1800 * t) * (1 - t / 0.004) : 0);
  }
  const rnd = noise(1234);
  const snare = n(0.28);
  const snareNoise = Float32Array.from(snare, () => rnd());
  highpass(snareNoise, fs, 900);
  for (let i = 0; i < snare.length; i++) {
    const t = i / fs;
    snare[i] = 0.8 * snareNoise[i]! * Math.exp(-t / 0.07) + 0.5 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.045);
  }
  const hatSrc = (sec: number, tau: number) => {
    const h = n(sec);
    for (let i = 0; i < h.length; i++) h[i] = rnd();
    highpass(h, fs, 7000);
    highpass(h, fs, 7000);
    for (let i = 0; i < h.length; i++) h[i]! *= 1.6 * Math.exp(-i / fs / tau);
    return h;
  };
  return { kick, snare, hat: hatSrc(0.08, 0.018), open: hatSrc(0.35, 0.11) };
}

function bpmAt(t: Pick<Timeline, 'tempoMap'>, ms: number): number {
  let bpm = t.tempoMap[0]?.bpm ?? 120;
  for (const x of t.tempoMap) if (x.ms <= ms + 0.5) bpm = x.bpm;
  return bpm;
}

/** Hit times (ms) and voices for the whole timeline. Bars are taken as 4/4 unless their spacing says otherwise. */
export function drumHits(t: Pick<Timeline, 'bars' | 'tempoMap' | 'events' | 'durationMs'>, pattern: DrumPattern): { ms: number; voice: Voice; vel: number }[] {
  if (pattern === 'none' || t.bars.length === 0) return [];
  const g = GROOVES[pattern];
  const out: { ms: number; voice: Voice; vel: number }[] = [];
  const musicEnd = Math.max(...t.events.map((e) => e.startMs + e.durationMs), t.bars[t.bars.length - 1]!.startMs);
  let prevBeats = 4;
  t.bars.forEach((bar, i) => {
    const beatMs = 60_000 / bpmAt(t, bar.startMs);
    const next = t.bars[i + 1]?.startMs;
    let beats = prevBeats;
    // Contiguous next bar: its spacing gives the bar length; otherwise (gap between passes, last bar) keep the meter.
    if (next !== undefined && next - bar.startMs < (prevBeats + 0.5) * beatMs) beats = Math.max(1, Math.round((next - bar.startMs) / beatMs));
    prevBeats = beats;
    const end = Math.min(bar.startMs + beats * beatMs, next ?? Infinity, Math.max(musicEnd, bar.startMs + beats * beatMs));
    const stepMs = beatMs / 4;
    for (let beat = 0; beat < beats; beat++) {
      for (const [step, voice, vel] of g.hits) {
        // The 4/4 groove repeats every 4 beats: take the hits that fall in this beat of the cycle.
        if (Math.floor(step / 4) !== beat % 4) continue;
        const inBeat = step % 4;
        // Swing: the off-beat eighth (step 2 of a beat) moves later; 16th offbeats stay put.
        const pos = inBeat === 2 ? 4 * g.swing : inBeat;
        const ms = bar.startMs + beat * beatMs + pos * stepMs;
        if (ms < end - 1) out.push({ ms, voice, vel });
      }
    }
  });
  return out.sort((a, b) => a.ms - b.ms);
}

/** Planar stereo drum track of `totalSamples`, peak-normalised to 1 (the mixer sets the level). */
export function renderDrums(t: Pick<Timeline, 'bars' | 'tempoMap' | 'events' | 'durationMs'>, pattern: DrumPattern, fs: number, totalSamples: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(totalSamples * 2);
  if (pattern === 'none') return out;
  const kit = synthKit(fs);
  const mono = new Float32Array(totalSamples);
  const hats = new Float32Array(totalSamples);
  for (const h of drumHits(t, pattern)) {
    const at = Math.round((h.ms * fs) / 1000);
    const src = kit[h.voice];
    const dst = h.voice === 'hat' || h.voice === 'open' ? hats : mono;
    for (let i = 0; i < src.length && at + i < totalSamples; i++) if (at + i >= 0) dst[at + i]! += src[i]! * h.vel;
  }
  const lp = GROOVES[pattern as Exclude<DrumPattern, 'none'>].lowpass;
  if (lp) {
    lowpass(mono, fs, lp);
    lowpass(hats, fs, lp);
  }
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    out[i] = mono[i]! + 0.85 * hats[i]!;
    out[totalSamples + i] = mono[i]! + hats[i]!;
    peak = Math.max(peak, Math.abs(out[i]!), Math.abs(out[totalSamples + i]!));
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! /= peak;
  return out;
}
