import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { autoDifficulty, barCounterText, inOutro, musicSpan, OPENER_LEAD_IN_MS, OUTRO_MS } from '../../src/render/overlays';
import { countInAt } from '../../src/render/drawFrame';
import { DEFAULT_STYLE, HOOK_LEAD_IN_MS, riffConfig } from './helpers/riffConfigFixture';

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
    // New riffs are hook-first: the riff sounds almost at once.
    expect(DEFAULT_STYLE.teach.hookFirst).toBe(true);
    const hook = riffConfig(DEFAULT_STYLE);
    expect(hook.leadInMs).toBe(HOOK_LEAD_IN_MS);
    expect(hook.tailMs).toBeUndefined();
    const plainStyle = { ...DEFAULT_STYLE, teach: { ...DEFAULT_STYLE.teach, hookFirst: false } };
    const plain = riffConfig(plainStyle);
    expect(plain.leadInMs).toBe(DEFAULT_STYLE.leadInMs);
    const guess = riffConfig({ ...DEFAULT_STYLE, render: { ...DEFAULT_STYLE.render, opener: 'guess' } });
    expect(guess.leadInMs).toBe(OPENER_LEAD_IN_MS);
    expect(guess.tailMs).toBe(OUTRO_MS);
    const heat = riffConfig({ ...plainStyle, render: { ...DEFAULT_STYLE.render, heatmap: true } });
    expect(heat.leadInMs).toBe(DEFAULT_STYLE.leadInMs);
    expect(heat.tailMs).toBe(OUTRO_MS);
  });
});

describe('count-in', () => {
  const ev = (startMs: number) => ({ id: String(startMs), startMs, durationMs: 200, stringIdx: 0, fret: 1, midi: 65, tech: [] });
  const t = {
    version: 1, title: 'T', tuning: [64, 59, 55, 50, 45, 40], capo: 0, tempoMap: [{ ms: 0, bpm: 100 }], leadInMs: 150, durationMs: 5000,
    events: [ev(150), ev(1000), ev(2800), ev(3600)],
    bars: [{ index: 0, startMs: 150 }],
    sections: [{ startMs: 150, endMs: 2000, label: 'Hook · full speed' }, { startMs: 2800, endMs: 4400, label: 'Full speed' }],
  } as unknown as Parameters<typeof countInAt>[0];
  it('hook first: no count-in before the hook (it plays at once), 3·2·1 in the gap before the next pass', () => {
    expect(countInAt(t, 0)).toBeNull();
    expect(countInAt(t, 1500)).toBeNull(); // the hook is playing
    expect(countInAt(t, 2010)?.n).toBe(3);
    expect(countInAt(t, 2400)?.n).toBe(2);
    expect(countInAt(t, 2700)?.n).toBe(1);
    expect(countInAt(t, 2800)).toBeNull();
  });
  it('a long lead-in counts 3·2·1 before the first note', () => {
    const long = { ...t, events: [ev(1200), ...t.events.slice(1)], sections: undefined };
    expect(countInAt(long, 0)?.n).toBe(3);
    expect(countInAt(long, 1100)?.n).toBe(1);
  });
});
