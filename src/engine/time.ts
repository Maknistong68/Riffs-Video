/**
 * The ONE place where frames, milliseconds and audio samples are converted.
 * Every renderer, encoder and checker must go through these helpers so the
 * rounding rule can never differ between audio and video.
 */

export type Fps = 30 | 60;

export const AUDIO_SAMPLE_RATE = 48_000;

/** frameIndex → ms on the timeline. Rule: round(frameIndex * 1000 / fps). */
export function frameToMs(frameIndex: number, fps: number): number {
  return Math.round((frameIndex * 1000) / fps);
}

/** First frame whose timeline ms is ≥ `ms` (the frame on which an event becomes visible). */
export function firstFrameAtOrAfter(ms: number, fps: number): number {
  let f = Math.ceil((ms * fps) / 1000);
  // Guard against the rounding rule: frameToMs(f - 1) may already round up to ms.
  while (f > 0 && frameToMs(f - 1, fps) >= ms) f--;
  while (frameToMs(f, fps) < ms) f++;
  return f;
}

/** Number of frames needed to cover `durationMs` (the last frame starts before durationMs). */
export function frameCount(durationMs: number, fps: number): number {
  return Math.ceil((durationMs * fps) / 1000);
}

/** Presentation timestamp of a frame in seconds, for the encoder (exact, not rounded). */
export function frameTimestampSec(frameIndex: number, fps: number): number {
  return frameIndex / fps;
}

/** ms → audio sample index. */
export function msToSample(ms: number, sampleRate: number = AUDIO_SAMPLE_RATE): number {
  return Math.round((ms * sampleRate) / 1000);
}

/** audio sample index → ms. */
export function sampleToMs(sample: number, sampleRate: number = AUDIO_SAMPLE_RATE): number {
  return (sample * 1000) / sampleRate;
}

/**
 * Audio length (samples) that exactly matches `frames` video frames, so the audio and
 * video streams end at the same instant (rule 3: match within 1 frame).
 */
export function samplesForFrames(frames: number, fps: number, sampleRate: number = AUDIO_SAMPLE_RATE): number {
  return Math.round((frames * sampleRate) / fps);
}
