import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  type AudioEncodingConfig,
} from 'mediabunny';

const PROBE_ONSET = 4800; // 100 ms at 48 kHz

/** Index of the first sample whose magnitude exceeds `threshold`, or -1. */
export function firstAbove(pcm: Float32Array, threshold: number, from = 0): number {
  for (let i = from; i < pcm.length; i++) if (Math.abs(pcm[i]!) > threshold) return i;
  return -1;
}

/**
 * Measure how many samples the audio encoder→decoder round trip delays the signal.
 * AAC encoders add priming samples (usually 1024); some report them with a negative
 * timestamp (→ the muxer writes an edit list and the delay is 0), others don't
 * (e.g. the WASM fallback). We measure instead of guessing, then the exporter offsets
 * the audio track by this amount so the decoded audio lands sample-exact.
 */
export async function measureAudioLatency(config: AudioEncodingConfig, sampleRate: number, channels: number): Promise<number> {
  const n = PROBE_ONSET * 3;
  const planar = new Float32Array(n * channels);
  for (let c = 0; c < channels; c++) {
    for (let i = PROBE_ONSET; i < PROBE_ONSET + 2400; i++) planar[c * n + i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new AudioSampleSource(config);
  output.addAudioTrack(source);
  await output.start();
  const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: channels, sampleRate, timestamp: 0 });
  await source.add(sample);
  sample.close();
  source.close();
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error('Latency probe produced no data');

  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(buf) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('Latency probe has no audio track');
  const pcm = new Float32Array(n * 2);
  for await (const s of new AudioSampleSink(track).samples()) {
    const tmp = new Float32Array(s.numberOfFrames);
    s.copyTo(tmp, { planeIndex: 0, format: 'f32-planar' });
    const offset = Math.round(s.timestamp * s.sampleRate);
    s.close();
    for (let i = 0; i < tmp.length; i++) if (offset + i >= 0 && offset + i < pcm.length) pcm[offset + i] = tmp[i]!;
  }
  // Apply the same threshold to the reference so detection bias cancels out.
  const reference = firstAbove(planar.subarray(0, n), 0.1);
  const detected = firstAbove(pcm, 0.1);
  if (detected < 0) throw new Error('Latency probe signal not found after decoding');
  return Math.max(0, detected - reference);
}
