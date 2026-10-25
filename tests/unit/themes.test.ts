import { describe, expect, it } from 'vitest';
import { SKINS } from '../../src/render/skins';
import { THEMES } from '../../src/render/theme';
import { TONE_PRESETS } from '../../src/audio/tone';
import { DRUM_PATTERNS } from '../../src/audio/drums';
import { GENRES } from '../../src/screens/studio/genres';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));

describe('genre themes', () => {
  for (const [id, th] of Object.entries(THEMES)) {
    it(`${id}: the highlight colour is far from every wood, inlay, fret and background (Sync Report probe)`, () => {
      const others = [th.background, th.backgroundTop, th.backgroundBottom, th.laneBg, ...Object.values(SKINS).flatMap((s) => [s.wood, s.woodGrain, s.inlay, s.fretWire, s.nut, ...(s.binding ? [s.binding] : [])])].filter(Boolean) as string[];
      for (const c of others) expect(dist(th.dot, c), `${th.dot} vs ${c}`).toBeGreaterThan(70);
      expect(dist(th.dot, th.dotText), 'dot label must be readable').toBeGreaterThan(200);
    });
  }
  it('every genre points at an existing theme, tone preset and drum groove', () => {
    for (const g of GENRES) {
      expect(THEMES[g.theme]).toBeDefined();
      expect(TONE_PRESETS.some((p) => p.id === g.tone)).toBe(true);
      expect(DRUM_PATTERNS.some((d) => d.id === g.drums)).toBe(true);
    }
  });
});
