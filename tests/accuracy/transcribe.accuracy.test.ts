/**
 * npm run accuracy — Phase 3 acceptance: transcription note accuracy ≥ 90 % before correction.
 * Held-out riffs (NOT the ones the cleanup rules were tuned on) are rendered with the synth,
 * roughened like a phone recording (noise floor, small-room reverb, level change), then run
 * through the real pipeline: Basic Pitch → cleanup → rhythm → fingering → alphaTex.
 * Real recordings still need checking on a device: see docs/STATUS.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { describe, expect, it } from 'vitest';
import { rmsEnvelope } from '../../src/audio/envelope';
import { detectOnsets } from '../../src/audio/onsets';
import { renderSynth, toMono } from '../../src/audio/synth';
import { transcribe } from '../../src/audio/transcribe';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { msToSample } from '../../src/engine/time';
import { loadAlphaTex } from '../../src/import/alphatab';
import { noteAccuracy, transcribeToRiff } from '../../src/import/transcribeRiff';

const root = join(__dirname, '../..');
const CLIPS = [
  ['demo', 'src/demo/midnight-pentatonic.atex'],
  ['demo', 'src/demo/power-drive.atex'],
  ['demo', 'src/demo/slow-bend-blues.atex'],
  ['golden', 'tests/golden/riffs/03-repeats.atex'],
  ['golden', 'tests/golden/riffs/04-tempo-ties.atex'],
  ['held-out', 'tests/accuracy/fingerpick.atex'],
] as const;

/** Seeded PRNG (mulberry32) — deterministic "recording" conditions. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Phone-ish recording: −42 dBFS noise floor, ~250 ms small-room reverb (wet 25 %), level × gain. */
function roughen(x: Float32Array, seed: number, gain: number): Float32Array {
  const r = rng(seed);
  const sr = 48_000;
  const irLen = Math.round(0.25 * sr);
  const out = new Float32Array(x.length);
  // Sparse exponentially decaying impulse response (cheap convolution).
  const taps: [number, number][] = [];
  for (let k = 0; k < 120; k++) {
    const d = Math.floor(r() * irLen) + 200;
    taps.push([d, (r() * 2 - 1) * Math.exp((-4 * d) / irLen) * 0.12]);
  }
  for (let i = 0; i < x.length; i++) {
    let wet = 0;
    for (const [d, g] of taps) if (i >= d) wet += x[i - d]! * g;
    out[i] = gain * (0.75 * x[i]! + 0.25 * wet * 4) + 0.008 * (r() * 2 - 1);
  }
  return out;
}

describe('transcription accuracy on held-out, recording-like clips', async () => {
  await tf.setBackend('cpu');
  const mj = JSON.parse(readFileSync(join(root, 'node_modules/@spotify/basic-pitch/model/model.json'), 'utf8'));
  const w = readFileSync(join(root, 'node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin'));
  const model = tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength), format: mj.format }));
  const soundFont = new Uint8Array(readFileSync(join(root, 'node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2')));
  const results: number[] = [];

  CLIPS.forEach(([kind, file], k) => {
    it(`${kind}: ${file}`, async () => {
      const { timeline: t, prepared } = buildTimeline(loadAlphaTex(readFileSync(join(root, file), 'utf8')), { ...DEFAULT_BUILD, trackIndex: 0 });
      const clean = toMono(renderSynth(prepared, { trackIndex: 0, sampleRate: 48_000, totalSamples: msToSample(t.durationMs), leadInMs: t.leadInMs, soundFont }), 2);
      const pcm = roughen(clean, 1000 + k, [0.6, 1.4, 0.9, 1.1, 0.7, 1.2][k]!);
      const detected = await transcribe(model, pcm, 48_000);
      const r = transcribeToRiff(detected, detectOnsets(pcm, 48_000), { tuning: t.tuning, capo: t.capo, title: file }, rmsEnvelope(pcm, 48_000));
      const truth = t.events.filter((e) => !e.tech.includes('dead'));
      const acc = noteAccuracy(truth, r.notes);
      results.push(acc.f1);
      console.log(`${file}: F1 ${acc.f1.toFixed(3)} (P ${acc.precision.toFixed(2)} R ${acc.recall.toFixed(2)}; ${acc.matched}/${acc.truth} true, ${acc.detected} detected) tempo ${r.bpm} vs ${t.tempoMap[0]!.bpm}`);
      if (process.env.ACCURACY_DEBUG) {
        const miss = truth.filter((e) => !r.notes.some((d) => d.midi === e.midi && Math.abs(d.startMs - e.startMs) <= 50)).map((e) => `${e.startMs.toFixed(0)}:${e.midi}${e.tech.length ? '(' + e.tech + ')' : ''}`);
        const extra = r.notes.filter((d) => !truth.some((e) => d.midi === e.midi && Math.abs(d.startMs - e.startMs) <= 50)).map((d) => `${d.startMs.toFixed(0)}:${d.midi}(a${d.amplitude.toFixed(2)}${d.snapped ? '' : ',unsnapped'})`);
        console.log(`  missed ${miss.join(' ')}\n  extra ${extra.join(' ')}`);
      }
      expect(acc.f1).toBeGreaterThanOrEqual(0.9);
    }, 240_000);
  });

  it('mean F1 ≥ 0.9', () => {
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`mean F1 over ${results.length} clips: ${mean.toFixed(3)}`);
    expect(mean).toBeGreaterThanOrEqual(0.9);
  });
});
