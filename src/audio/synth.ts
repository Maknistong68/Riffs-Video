/**
 * alphaTab synth → PCM. Renders the SAME MidiFile the timeline was built from (prepareScore),
 * offline, at 48 kHz, chunk by chunk. Output is planar stereo [L…, R…] of exactly `totalSamples`,
 * with the lead-in as leading silence (the timeline's leadInMs, applied nowhere else).
 */
import { alphaTab, type PreparedScore } from '../import/alphatab';
import { msToSample } from '../engine/time';
import type { Arrangement } from '../engine/arrange';

export type SynthOptions = {
  trackIndex: number;
  sampleRate: number;
  totalSamples: number;
  leadInMs: number;
  soundFont: Uint8Array;
  /** 0 = off. alphaTab metronome ("Synth + click" mode). */
  metronomeVolume?: number;
  /** Guitar track volume (0 renders the metronome alone, so it can bypass the pedals). */
  trackVolume?: number;
  /** Render only this play-order tick range (audio time 0 = range start). */
  range?: { startTick: number; endTick: number };
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
  if (opts.range) {
    const r = new alphaTab.synth.PlaybackRange();
    r.startTick = opts.range.startTick;
    r.endTick = opts.range.endTick;
    options.playbackRange = r;
  }
  // Only the chosen guitar track is audible: the Sync Report checks exactly these notes.
  for (const t of score.tracks) {
    const v = t.index === opts.trackIndex ? (opts.trackVolume ?? 1) : 0;
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

/**
 * alphaTab silences every voice instantly when the song (or a playback range) ends, which
 * clicks. Fade into that edge instead.
 */
const CUT_FADE_MS = 15;

/** Render every arrangement part and place it at its exact sample offset (planar stereo). */
export function renderArrangement(
  arr: Arrangement,
  opts: Omit<SynthOptions, 'totalSamples' | 'leadInMs' | 'range' | 'onProgress'> & { totalSamples: number; onProgress?: (f: number) => void },
): Float32Array<ArrayBuffer> {
  const n = opts.totalSamples;
  const out = new Float32Array(n * SYNTH_CHANNELS);
  const cache = new Map<string, Float32Array>();
  arr.parts.forEach((part, k) => {
    const len = Math.min(part.lengthSamples + part.ringSamples, n - part.startSample);
    if (len <= 0) return;
    const key = `${part.speed}|${part.range?.startTick ?? ''}|${part.range?.endTick ?? ''}|${len}`;
    let pcm = cache.get(key);
    if (!pcm) {
      pcm = renderSynth(part.prepared, {
        ...opts,
        totalSamples: len,
        leadInMs: 0,
        ...(part.range ? { range: part.range } : {}),
        onProgress: (f) => opts.onProgress?.((k + f) / arr.parts.length),
      });
      fadeOutAt(pcm, len, part.lengthSamples, msToSample(CUT_FADE_MS, opts.sampleRate));
      cache.set(key, pcm);
    }
    for (let c = 0; c < SYNTH_CHANNELS; c++) {
      for (let i = 0; i < len; i++) out[c * n + part.startSample + i]! += pcm[c * len + i]!;
    }
  });
  return out;
}

/** Linear fade reaching silence at `end` (samples), silence after. Planar stereo, in place. */
export function fadeOutAt(pcm: Float32Array, len: number, end: number, fade: number): void {
  const f = Math.max(1, Math.min(end, fade));
  for (let c = 0; c < SYNTH_CHANNELS; c++) {
    for (let i = Math.max(0, end - f); i < len; i++) {
      pcm[c * len + i]! *= i >= end ? 0 : (end - i) / f;
    }
  }
}
