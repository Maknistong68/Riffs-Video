/** One-off generator (MAKE_FIXTURES=1 npm run accuracy -- -t fixture): a WAV for the e2e audio-import test. */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { resample } from '../../src/audio/resample';
import { renderSynth, toMono } from '../../src/audio/synth';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { msToSample } from '../../src/engine/time';
import { loadAlphaTex } from '../../src/import/alphatab';

it.skipIf(!process.env.MAKE_FIXTURES)('fixture: writes tests/fixtures/audio/midnight-pentatonic.wav', () => {
  const sf = new Uint8Array(readFileSync('node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2'));
  const { timeline: t, prepared } = buildTimeline(loadAlphaTex(readFileSync('src/demo/midnight-pentatonic.atex', 'utf8')), { ...DEFAULT_BUILD, trackIndex: 0 });
  const mono = toMono(renderSynth(prepared, { trackIndex: 0, sampleRate: 48000, totalSamples: msToSample(t.durationMs), leadInMs: 600, soundFont: sf }), 2);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < mono.length; i++) mono[i] = 0.9 * mono[i]! + 0.006 * noise();
  const sr = 24000;
  const pcm = resample(mono, 48000, sr);
  const data = Buffer.alloc(44 + pcm.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + pcm.length * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24);
  data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i]! * 32767))), 44 + i * 2);
  writeFileSync('tests/fixtures/audio/midnight-pentatonic.wav', data);
});
