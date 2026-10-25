/**
 * The "Studio guitars" pack must not make notes late: every sample starts (almost) at its attack,
 * so the synth sounds each note within a fraction of a frame of its timeline time (CLAUDE.md §3).
 * Reads alphaTab's decoded regions (internal fields), the same samples the exporter plays.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { alphaTab, loadAlphaTex } from '../../src/import/alphatab';

type Region = { samples: Float32Array; sampleRate: number };
const pack = new Uint8Array(readFileSync(join(__dirname, '../../src/assets/soundfonts/riffreel-guitars.sf3')));
const stub = { ready: { on() {}, off() {} }, samplesPlayed: { on() {}, off() {} }, sampleRequest: { on() {}, off() {} }, deviceChanged: { on() {}, off() {} }, open() {}, play() {}, destroy() {}, pause() {}, addSamples() {}, resetSamples() {}, activate() {}, sampleRate: 48000 };

describe('"Studio guitars" sound pack', () => {
  for (const program of [24, 25, 26, 27, 33]) {
    it(`program ${program}: every sample's attack is within 10 ms of its start`, () => {
      const tex = `\\tempo 100\n\\track "G"\n\\instrument ${program}\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:4 5.3`;
      const { prepared } = buildTimeline(loadAlphaTex(tex), { ...DEFAULT_BUILD, trackIndex: 0 });
      const options = new alphaTab.synth.AudioExportOptions();
      options.sampleRate = 48000;
      options.soundFonts = [pack];
      const synth = new alphaTab.synth.AlphaSynth(stub as never, 500);
      const ex = synth.exportAudio(options, prepared.midi, prepared.syncPoints, prepared.transpositionPitches) as unknown as {
        _synth: { presets: { presetNumber: number; bank: number; regions: Region[] }[] };
      };
      const preset = ex._synth.presets.find((p) => p.presetNumber === program && p.bank === 0);
      expect(preset, `preset ${program} in the pack`).toBeDefined();
      const regions = preset!.regions.filter((r) => r.samples?.length);
      expect(regions.length).toBeGreaterThan(0);
      for (const r of regions) {
        let peak = 0;
        for (const x of r.samples) peak = Math.max(peak, Math.abs(x));
        const lead = (r.samples.findIndex((x) => Math.abs(x) > peak * 0.1) / r.sampleRate) * 1000;
        expect(lead).toBeLessThan(10);
      }
    });
  }
});
