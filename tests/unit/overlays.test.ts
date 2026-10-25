import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { autoDifficulty, barCounterText, inOutro, musicSpan, OPENER_LEAD_IN_MS, OUTRO_MS } from '../../src/render/overlays';
import { DEFAULT_STYLE, riffConfig } from './helpers/riffConfigFixture';

const TEX = '\\tempo 120\n\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:4 0.6 3.6 5.6 3.6 | 0.6 3.6 5.6 3.6';
const t = buildTimeline(loadAlphaTex(TEX), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;

describe('overlay timing', () => {
  it('bar counter follows the bars while the music plays only', () => {
    const span = musicSpan(t);
    expect(barCounterText(t, 0)).toBeNull();
    expect(barCounterText(t, span.firstMs + 10)).toBe('Bar 1 / 2');
    expect(barCounterText(t, t.bars[1]!.startMs + 10)).toBe('Bar 2 / 2');
    expect(barCounterText(t, span.lastEndMs + 100)).toBeNull();
  });
  it('outro starts shortly after the last note ends', () => {
    const { lastEndMs } = musicSpan(t);
    expect(inOutro(t, lastEndMs)).toBe(false);
    expect(inOutro(t, lastEndMs + 300)).toBe(true);
    expect(autoDifficulty(t)).toMatch(/Easy|Medium|Hard/);
  });
  it('riffConfig adds the opener lead-in and the outro tail only when needed', () => {
    const plain = riffConfig(DEFAULT_STYLE);
    expect(plain.leadInMs).toBe(DEFAULT_STYLE.leadInMs);
    expect(plain.tailMs).toBeUndefined();
    const guess = riffConfig({ ...DEFAULT_STYLE, render: { ...DEFAULT_STYLE.render, opener: 'guess' } });
    expect(guess.leadInMs).toBe(OPENER_LEAD_IN_MS);
    expect(guess.tailMs).toBe(OUTRO_MS);
    const heat = riffConfig({ ...DEFAULT_STYLE, render: { ...DEFAULT_STYLE.render, heatmap: true } });
    expect(heat.leadInMs).toBe(DEFAULT_STYLE.leadInMs);
    expect(heat.tailMs).toBe(OUTRO_MS);
  });
});
