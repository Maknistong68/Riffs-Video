import { describe, expect, it } from 'vitest';
import { buildCaption } from '../../src/engine/caption';
import type { NoteEvent } from '../../src/engine/timeline';

const ev = (tech: NoteEvent['tech'] = []): NoteEvent => ({ id: 'a', startMs: 0, durationMs: 100, stringIdx: 5, fret: 0, midi: 38, tech });
const timeline = { tuning: [64, 59, 55, 50, 45, 38], capo: 0, tempoMap: [{ ms: 0, bpm: 100 }], events: [ev(['palmMute']), ev(['bend'])] };

describe('buildCaption', () => {
  it('builds a title, caption and at most 8 unique hashtags', () => {
    const c = buildCaption({ title: 'Iris', artist: 'The Goo Goo Dolls', timeline, difficulty: 'Easy', genre: 'acoustic', isOriginal: false, teach: { slowMo: true }, part: { part: 1, parts: 3 } });
    expect(c.title).toBe('Iris – The Goo Goo Dolls guitar lesson (Part 1/3)');
    expect(c.caption).toContain('Drop D');
    expect(c.caption).toContain('100 bpm');
    expect(c.caption).toContain('(Part 1/3)');
    expect(c.hashtags.length).toBeLessThanOrEqual(8);
    expect(new Set(c.hashtags).size).toBe(c.hashtags.length);
    expect(c.hashtags).toContain('#iris');
    expect(c.hashtags).toContain('#guitarlesson');
    expect(c.hashtags.every((h) => /^#[a-z0-9]+$/.test(h))).toBe(true);
    expect(c.full.endsWith(c.hashtags.join(' '))).toBe(true);
  });
  it('original riffs say so and carry the practice link', () => {
    const c = buildCaption({ title: 'Riff of the day', timeline, isOriginal: true, practiceUrl: 'https://x/#/p/abc' });
    expect(c.caption).toContain('Original riff');
    expect(c.caption).toContain('https://x/#/p/abc');
    expect(c.hashtags[2]).toBe('#guitarriff');
  });
  it('accents and symbols become plain tags', () => {
    expect(buildCaption({ title: 'Café del Mar!', timeline, isOriginal: false }).hashtags).toContain('#cafedelmar');
  });
});
