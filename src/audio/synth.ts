/**
 * alphaTab synth → PCM. Renders the SAME MidiFile the timeline was built from (prepareScore),
 * offline, at 48 kHz, chunk by chunk. Output is planar stereo [L…, R…] of exactly `totalSamples`,
 * with the lead-in as leading silence (the timeline's leadInMs, applied nowhere else).
 */
import { alphaTab, type PreparedScore } from '../import/alphatab';
import { msToSample } from '../engine/time';

export type SynthOptions = {
  trackIndex: number;
  sampleRate: number;
  totalSamples: number;
  leadInMs: number;
  soundFont: Uint8Array;
  /** 0 = off. alphaTab metronome ("Synth + click" mode). */
  metronomeVolume?: number;
  /** Called with 0..1 while rendering. */
  onProgress?: (fraction: number) => void;
};

export const SYNTH_CHANNELS = 2;

/** AlphaSynth needs an output object even for offline export; nothing is ever played. */
function silentOutput(sampleRate: number): alphaTab.synth.ISynthOutput {
  const emitter = { on: () => undefined, off: () => undefined };
  const output = {
    sampleRate,
    ready: emitter,
    samplesPlayed: emitter,
    sampleRequest: emitter,
    deviceChanged: emitter,
    open: () => undefined,
    play: () => undefined,
    destroy: () => undefined,
    pause: () => undefined,
    addSamples: () => undefined,
    resetSamples: () => undefined,
    activate: () => undefined,
    enumerateOutputDevices: () => Promise.resolve([]),
    setOutputDevice: () => Promise.resolve(),
    getOutputDevice: () => Promise.resolve(null),
  };
  // Structural stub: alphaTab only touches the members above during offline export.
  return output as unknown as alphaTab.synth.ISynthOutput;
}

export function renderSynth(prepared: PreparedScore, opts: SynthOptions): Float32Array<ArrayBuffer> {
  const { score, midi, syncPoints, transpositionPitches } = prepared;
  const options = new alphaTab.synth.AudioExportOptions();
  options.sampleRate = opts.sampleRate;
  options.soundFonts = [opts.soundFont];
  options.masterVolume = 1;
  options.metronomeVolume = opts.metronomeVolume ?? 0;
  options.useSyncPoints = false;
  // Only the chosen guitar track is audible: the Sync Report checks exactly these notes.
  for (const t of score.tracks) {
    const v = t.index === opts.trackIndex ? 1 : 0;
    options.trackVolume.set(t.playbackInfo.primaryChannel, v);
    options.trackVolume.set(t.playbackInfo.secondaryChannel, v);
  }

  const synth = new alphaTab.synth.AlphaSynth(silentOutput(opts.sampleRate), 500);
  const exporter = synth.exportAudio(options, midi, syncPoints, transpositionPitches);

  const n = opts.totalSamples;
  const out = new Float32Array(n * SYNTH_CHANNELS);
  let pos = msToSample(opts.leadInMs, opts.sampleRate);
  const chunkMs = 500;
  for (;;) {
    if (pos >= n) break;
    const chunk = exporter.render(chunkMs);
    if (!chunk) break;
    const s = chunk.samples; // interleaved L R L R
    const frames = s.length / SYNTH_CHANNELS;
    for (let i = 0; i < frames && pos + i < n; i++) {
      out[pos + i] = s[i * 2]!;
      out[n + pos + i] = s[i * 2 + 1]!;
    }
    pos += frames;
    opts.onProgress?.(Math.min(1, pos / n));
    if (chunk.currentTime + chunkMs >= chunk.endTime + 4000) break; // safety: never spin forever
  }
  synth.destroy();
  return out;
}

/** Mono mixdown (for analysis). */
export function toMono(planar: Float32Array, channels: number): Float32Array<ArrayBuffer> {
  const n = planar.length / channels;
  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) for (let i = 0; i < n; i++) out[i]! += planar[c * n + i]! / channels;
  return out;
}
