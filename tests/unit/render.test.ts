import { describe, expect, it } from 'vitest';
import { classicLayout, defaultFrameSettings } from '../../src/render/drawFrame';
import { dotPosition, fretX, vibrationAmplitude } from '../../src/render/neck2d';

describe('neck geometry', () => {
  const s = defaultFrameSettings(30);
  const { neck, lane } = classicLayout(s, 6);

  it('fret spacing shrinks towards the body', () => {
    const w1 = fretX(neck, 1) - fretX(neck, 0);
    const w12 = fretX(neck, 12) - fretX(neck, 11);
    expect(w1).toBeGreaterThan(w12);
    expect(fretX(neck, 0)).toBe(neck.x0);
    expect(fretX(neck, 12)).toBeCloseTo(neck.x1);
  });

  it('high e is drawn on top (P5)', () => {
    expect(dotPosition(neck, 0, 1).y).toBeLessThan(dotPosition(neck, 5, 1).y);
  });

  it('everything stays out of the TikTok safe zones (P17)', () => {
    expect(neck.x1).toBeLessThan(s.width - s.safeZones.rightPx);
    expect(lane.x1).toBeLessThanOrEqual(s.width - s.safeZones.rightPx);
    expect(lane.y1).toBeLessThan(s.height - s.safeZones.bottomPx);
  });

  it('string vibration is deterministic and only while the note sounds', () => {
    expect(vibrationAmplitude(-1, 300)).toBe(0);
    expect(vibrationAmplitude(300, 300)).toBe(0);
    expect(vibrationAmplitude(0, 300)).toBe(12);
    expect(vibrationAmplitude(100, 300)).toBe(vibrationAmplitude(100, 300));
  });
});
