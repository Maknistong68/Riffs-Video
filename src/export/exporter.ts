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
import { alignedFrameCount, AUDIO_SAMPLE_RATE, frameCount, frameTimestampSec, samplesForFrames } from '../engine/time';
import { validateTimeline, type Timeline } from '../engine/timeline';
import { drawFrame, type FrameSettings } from '../render/drawFrame';
import { measureAudioLatency } from './encoderLatency';

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

export const AUDIO_CHANNELS = 2;

/** Pick encoders; registers the WASM AAC encoder only when the browser has no native AAC (P21). */
export async function prepareCodecs(width: number, height: number, fps: number): Promise<ExportInfo['audioEncoder']> {
  if (!(await canEncodeVideo('avc', { width, height, frameRate: fps }))) {
    throw new Error(`This browser cannot encode H.264 video at ${width}×${height}. Please update your browser.`);
  }
  if (await canEncodeAudio('aac', { numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE })) return 'native';
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  return 'wasm-fallback';
}

export type ExportPlan = {
  fps: number;
  /** ≥ frameCount(durationMs): extended so the AAC stream needs no end padding. */
  frames: number;
  totalSamples: number;
  audioLatencySamples: number;
  audioEncoder: ExportInfo['audioEncoder'];
};

const AUDIO_CONFIG: AudioEncodingConfig = { codec: 'aac', quality: QUALITY_HIGH };
const AAC_FRAME_SIZE = 1024;

/** Check codecs and measure the encoder's priming delay, then fix frame/sample counts. */
export async function planExport(timeline: Timeline, settings: FrameSettings): Promise<ExportPlan> {
  const fps = settings.fps;
  const audioEncoder = await prepareCodecs(settings.width, settings.height, fps);
  const audioLatencySamples = await measureAudioLatency(AUDIO_CONFIG, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS);
  const frames = alignedFrameCount(frameCount(timeline.durationMs, fps), fps, audioLatencySamples, AAC_FRAME_SIZE);
  return { fps, frames, totalSamples: samplesForFrames(frames, fps), audioLatencySamples, audioEncoder };
}

/**
 * Render every frame with drawFrame and encode it with the given audio → MP4 (H.264 + AAC).
 * `audio` is planar stereo at 48 kHz, exactly plan.totalSamples long.
 */
export async function exportMp4(
  timeline: Timeline,
  audio: Float32Array,
  settings: FrameSettings,
  plan: ExportPlan,
  onProgress: (p: ExportProgress) => void,
  isCancelled: () => boolean = () => false,
): Promise<{ data: ArrayBuffer; info: ExportInfo }> {
  const issues = validateTimeline(timeline);
  if (issues.length > 0) throw new Error(`Timeline invalid: ${issues.map((i) => i.message).join('; ')}`);
  const fps = settings.fps;
  const started = performance.now();
  const { frames, totalSamples, audioEncoder, audioLatencySamples: latency } = plan;
  if (audio.length !== totalSamples * AUDIO_CHANNELS) throw new Error('Audio length does not match video length');

  const canvas = new OffscreenCanvas(settings.width, settings.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH });
  const audioSource = new AudioSampleSource(AUDIO_CONFIG);
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audioSource);
  await output.start();

  const chunk = AUDIO_SAMPLE_RATE;
  let audioPos = 0;
  const pushAudioUntil = async (sampleIdx: number) => {
    while (audioPos < Math.min(sampleIdx, totalSamples)) {
      const n = Math.min(chunk, totalSamples - audioPos);
      const planar = new Float32Array(n * AUDIO_CHANNELS);
      for (let c = 0; c < AUDIO_CHANNELS; c++) {
        planar.set(audio.subarray(c * totalSamples + audioPos, c * totalSamples + audioPos + n), c * n);
      }
      const sample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: AUDIO_CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE,
        // Shift by the measured priming delay: the muxer turns the negative start into an
        // MP4 edit list, so players skip the priming and the first real sample plays at t=0.
        timestamp: (audioPos - latency) / AUDIO_SAMPLE_RATE,
      });
      await audioSource.add(sample);
      sample.close();
      audioPos += n;
    }
  };

  try {
    for (let f = 0; f < frames; f++) {
      if (isCancelled()) throw new DOMException('Export cancelled', 'AbortError');
      await pushAudioUntil(samplesForFrames(f + 1, fps) + chunk);
      drawFrame(ctx, timeline, f, settings);
      await video.add(frameTimestampSec(f, fps), 1 / fps);
      if (f % 5 === 0 || f === frames - 1) onProgress({ frame: f + 1, frames });
    }
    await pushAudioUntil(totalSamples);
    video.close();
    audioSource.close();
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
