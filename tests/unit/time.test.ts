import { describe, expect, it } from 'vitest';
import { alignedFrameCount, firstFrameAtOrAfter, frameCount, frameToMs, msToSample, samplesForFrames } from '../../src/engine/time';

describe('time', () => {
  it('uses round(frame * 1000 / fps)', () => {
    expect(frameToMs(0, 30)).toBe(0);
    expect(frameToMs(1, 30)).toBe(33);
    expect(frameToMs(2, 30)).toBe(67);
    expect(frameToMs(3, 30)).toBe(100);
    expect(frameToMs(1, 60)).toBe(17);
  });

  it('firstFrameAtOrAfter is the first frame whose ms ≥ target', () => {
    for (const fps of [30, 60]) {
      for (let ms = 0; ms < 5000; ms += 7) {
        const f = firstFrameAtOrAfter(ms, fps);
        expect(frameToMs(f, fps)).toBeGreaterThanOrEqual(ms);
        if (f > 0) expect(frameToMs(f - 1, fps)).toBeLessThan(ms);
      }
    }
  });

  it('audio length matches video length exactly', () => {
    const frames = frameCount(4400, 30);
    expect(frames).toBe(132);
    expect(samplesForFrames(frames, 30)).toBe(132 * 1600);
    expect(samplesForFrames(frameCount(4400, 60), 60)).toBe(264 * 800);
    expect(msToSample(1000)).toBe(48000);
  });

  it('aligned frame count leaves no AAC padding', () => {
    for (const fps of [30, 60]) {
      for (const priming of [0, 1024, 2112]) {
        const f = alignedFrameCount(132, fps, priming);
        expect(f).toBeGreaterThanOrEqual(132);
        expect(f - 132).toBeLessThan(64);
        const pad = (1024 - ((samplesForFrames(f, fps) + priming) % 1024)) % 1024;
        expect(pad).toBeLessThan(32);
        if (priming % 32 === 0) expect(pad).toBe(0);
      }
    }
  });
});
