import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectOnsets } from '../../src/audio/onsets';
import { renderSynth, toMono } from '../../src/audio/synth';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { frameCount, msToSample, samplesForFrames } from '../../src/engine/time';
import { loadAlphaTex } from '../../src/import/alphatab';

const golden = join(__dirname, '../golden/riffs');
const soundFont = new Uint8Array(readFileSync(join(__dirname, '../../node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2')));

describe('alphaTab synth renders exactly on the timeline (rule 2)', () => {
  for (const f of readdirSync(golden).filter((x) => x.endsWith('.atex')).sort()) {
    it(f, () => {
      const { timeline: t, prepared } = buildTimeline(loadAlphaTex(readFileSync(join(golden, f), 'utf8')), { ...DEFAULT_BUILD, trackIndex: 0 });
      const totalSamples = samplesForFrames(frameCount(t.durationMs, 30), 30);
      const pcm = renderSynth(prepared, { trackIndex: 0, sampleRate: 48_000, totalSamples, leadInMs: t.leadInMs, soundFont });
      expect(pcm.length).toBe(totalSamples * 2);
      const mono = toMono(pcm, 2);
      // Lead-in is silent.
      for (let i = 0; i < msToSample(t.leadInMs) - 10; i++) expect(mono[i]).toBe(0);
      const onsets = detectOnsets(mono, 48_000);
      const expected = [...new Set(t.events.filter((e) => !e.legato).map((e) => e.startMs))];
      for (const ms of expected) {
        const nearest = Math.min(...onsets.map((o) => Math.abs(o - ms)));
        expect(nearest, `onset near ${ms.toFixed(1)} ms`).toBeLessThan(8);
      }
    });
  }
});

describe('"Studio guitars" sound pack (FluidR3 subset, SF3)', () => {
  const guitars = new Uint8Array(readFileSync(join(__dirname, '../../src/assets/soundfonts/riffreel-guitars.sf3')));
  for (const program of [24, 25, 26, 27, 33]) {
    it(`GM program ${program} sounds, on time`, () => {
      const tex = `\\tempo 100\n\\track "G" { instrument ${program} }\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:4 5.3 7.3 5.2 8.1 | :2 7.4 5.5`;
      const { timeline: t, prepared } = buildTimeline(loadAlphaTex(tex), { ...DEFAULT_BUILD, trackIndex: 0 });
      const totalSamples = samplesForFrames(frameCount(t.durationMs, 30), 30);
      const mono = toMono(renderSynth(prepared, { trackIndex: 0, sampleRate: 48_000, totalSamples, leadInMs: t.leadInMs, soundFont: guitars }), 2);
      let peak = 0;
      for (const x of mono) peak = Math.max(peak, Math.abs(x));
      expect(peak).toBeGreaterThan(0.02);
      const onsets = detectOnsets(mono, 48_000);
      for (const ms of [...new Set(t.events.map((e) => e.startMs))]) {
        // Sampled guitars rise slower than the energy detector likes; exact timing is checked by
        // Basic Pitch in the Sync Report (golden/e2e). Here: every note sounds near its time.
        expect(Math.min(...onsets.map((o) => Math.abs(o - ms))), `onset near ${ms.toFixed(1)} ms`).toBeLessThan(70);
      }
    });
  }
});
