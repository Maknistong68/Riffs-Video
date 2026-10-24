import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeAudio,
  canEncodeVideo,
  type AudioEncodingConfig,
} from 'mediabunny';
import { renderBeeps } from '../audio/beeps';
import { measureAudioLatency } from './encoderLatency';
import { AUDIO_SAMPLE_RATE, frameCount, frameTimestampSec, samplesForFrames } from '../engine/time';
import { validateTimeline, type Timeline } from '../engine/timeline';
import { defaultFrameSettings, drawFrame } from '../render/drawFrame';

export type ExportOptions = { fps: 30 | 60 };

export type ExportInfo = {
  frames: number;
  audioSamples: number;
  audioEncoder: 'native' | 'wasm-fallback';
  /** Encoder priming delay that was measured and compensated (samples). */
  audioLatencySamples: number;
  elapsedMs: number;
  sizeBytes: number;
};

export type ExportProgress = { frame: number; frames: number };

const CHANNELS = 2;

/** Pick encoders; registers the WASM AAC encoder only when the browser has no native AAC (P21). */
export async function prepareCodecs(width: number, height: number, fps: number): Promise<ExportInfo['audioEncoder']> {
  if (!(await canEncodeVideo('avc', { width, height, frameRate: fps }))) {
    throw new Error(`This browser cannot encode H.264 video at ${width}×${height}. Please update your browser.`);
  }
  if (await canEncodeAudio('aac', { numberOfChannels: CHANNELS, sampleRate: AUDIO_SAMPLE_RATE })) return 'native';
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  return 'wasm-fallback';
}

/** Render every frame with drawFrame + encode beeps → MP4 (H.264 + AAC), fully on-device. */
export async function exportMp4(
  timeline: Timeline,
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<{ data: ArrayBuffer; info: ExportInfo }> {
  const issues = validateTimeline(timeline);
  if (issues.length > 0) throw new Error(`Timeline invalid: ${issues.map((i) => i.message).join('; ')}`);

  const started = performance.now();
  const settings = defaultFrameSettings(opts.fps);
  const audioEncoder = await prepareCodecs(settings.width, settings.height, opts.fps);

  const frames = frameCount(timeline.durationMs, opts.fps);
  const totalSamples = samplesForFrames(frames, opts.fps);
  const mono = renderBeeps(timeline, totalSamples, AUDIO_SAMPLE_RATE);

  const canvas = new OffscreenCanvas(settings.width, settings.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');

  const audioConfig: AudioEncodingConfig = { codec: 'aac', quality: QUALITY_HIGH };
  const latency = await measureAudioLatency(audioConfig, AUDIO_SAMPLE_RATE, CHANNELS);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH });
  const audio = new AudioSampleSource(audioConfig);
  output.addVideoTrack(video, { frameRate: opts.fps });
  output.addAudioTrack(audio);
  await output.start();

  // Interleave audio (1 s chunks, planar stereo) with video so the muxer never buffers much.
  const chunk = AUDIO_SAMPLE_RATE;
  let audioPos = 0;
  const pushAudioUntil = async (sampleIdx: number) => {
    while (audioPos < Math.min(sampleIdx, totalSamples)) {
      const n = Math.min(chunk, totalSamples - audioPos);
      const planar = new Float32Array(n * CHANNELS);
      const slice = mono.subarray(audioPos, audioPos + n);
      for (let c = 0; c < CHANNELS; c++) planar.set(slice, c * n);
      const sample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE,
        // Shift by the measured priming delay: the muxer turns the negative start into an
        // MP4 edit list, so players skip the priming and the first real sample plays at t=0.
        timestamp: (audioPos - latency) / AUDIO_SAMPLE_RATE,
      });
      await audio.add(sample);
      sample.close();
      audioPos += n;
    }
  };

  try {
    for (let f = 0; f < frames; f++) {
      await pushAudioUntil(samplesForFrames(f + 1, opts.fps) + chunk);
      drawFrame(ctx, timeline, f, settings);
      await video.add(frameTimestampSec(f, opts.fps), 1 / opts.fps);
      if (f % 5 === 0 || f === frames - 1) onProgress({ frame: f + 1, frames });
    }
    await pushAudioUntil(totalSamples);
    video.close();
    audio.close();
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }

  const data = output.target.buffer;
  if (!data) throw new Error('Muxer produced no data');
  return {
    data,
    info: {
      frames,
      audioSamples: totalSamples,
      audioEncoder,
      audioLatencySamples: latency,
      elapsedMs: Math.round(performance.now() - started),
      sizeBytes: data.byteLength,
    },
  };
}
