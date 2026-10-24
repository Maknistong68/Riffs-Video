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
