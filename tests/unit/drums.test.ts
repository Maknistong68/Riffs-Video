import { describe, expect, it } from 'vitest';
import { drumHits, renderDrums, synthKit } from '../../src/audio/drums';
import { detectOnsets } from '../../src/audio/onsets';
import { buildArrangement } from '../../src/engine/arrange';
import { loadAlphaTex } from '../../src/import/alphatab';

const TEX = '\\tempo 120\n\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:4 0.6 3.6 5.6 3.6 | 0.6 3.6 5.6 3.6 |\n\\tempo 60 :4 0.6 3.6 5.6 3.6';
const t = buildArrangement(() => loadAlphaTex(TEX), { trackIndex: 0, leadInMs: 1000, tailMs: 1200, teach: { slowMo: false, loopHardest: false } }).timeline;

describe('drums', () => {
  it('rock: kick on 1, snare on 2 and 4, eighth hats — following the tempo map', () => {
    const hits = drumHits(t, 'rock');
    const bar1 = t.bars[0]!.startMs;
    const kicks = hits.filter((h) => h.voice === 'kick' && h.ms < bar1 + 2000).map((h) => h.ms - bar1);
    const snares = hits.filter((h) => h.voice === 'snare' && h.ms < bar1 + 2000).map((h) => h.ms - bar1);
    expect(kicks[0]).toBeCloseTo(0, 6);
    expect(snares.map((x) => Math.round(x))).toEqual([500, 1500]);
    expect(hits.filter((h) => h.voice === 'hat' && h.ms < bar1 + 2000)).toHaveLength(8);
    // Bar 3 is at 60 bpm: snare on beat 2 is 1000 ms after the bar.
    const bar3 = t.bars[2]!.startMs;
    expect(Math.round(hits.find((h) => h.voice === 'snare' && h.ms > bar3)!.ms - bar3)).toBe(1000);
    // nothing after the music, nothing in the lead-in
    expect(hits.every((h) => h.ms >= t.leadInMs - 1)).toBe(true);
    expect(hits[hits.length - 1]!.ms).toBeLessThan(bar3 + 4000);
  });

  it('blues swing moves the off-beat eighth to the triplet position', () => {
    const bar1 = t.bars[0]!.startMs;
    const hats = drumHits(t, 'blues').filter((h) => h.voice === 'hat' && h.ms < bar1 + 500).map((h) => Math.round(h.ms - bar1));
    expect(hats).toEqual([0, 335]); // 500 ms beat: 2/3 of it
  });

  it('follows slow-mo passes (bars of every pass, none in the gaps)', () => {
    const slow = buildArrangement(() => loadAlphaTex(TEX), { trackIndex: 0, leadInMs: 1000, tailMs: 1200, teach: { slowMo: true, loopHardest: false } }).timeline;
    const hits = drumHits(slow, 'rock');
    for (let i = 0; i < slow.sections!.length - 1; i++) {
      const gapStart = slow.sections![i]!.endMs;
      const gapEnd = slow.sections![i + 1]!.startMs;
      expect(hits.filter((h) => h.ms > gapStart + 5 && h.ms < gapEnd - 5)).toEqual([]);
    }
  });

  it('renders deterministic audio with attacks where the hits are', () => {
    const fs = 48_000;
    const n = Math.ceil((t.durationMs / 1000) * fs);
    const a = renderDrums(t, 'rock', fs, n);
    expect(a).toEqual(renderDrums(t, 'rock', fs, n));
    expect(Math.max(...a.subarray(0, Math.round(fs * 0.9)).map(Math.abs))).toBe(0); // silent lead-in
    const onsets = detectOnsets(a.subarray(0, n), fs);
    const kicksSnares = drumHits(t, 'rock').filter((h) => h.voice !== 'hat');
    for (const h of kicksSnares) expect(Math.min(...onsets.map((o) => Math.abs(o - h.ms)))).toBeLessThan(10);
    expect(renderDrums(t, 'none', fs, 100).every((v) => v === 0)).toBe(true);
  });

  it('kit voices are finite and decay to silence', () => {
    const kit = synthKit(48_000);
    for (const v of Object.values(kit)) {
      expect(v.every(Number.isFinite)).toBe(true);
      expect(Math.abs(v[v.length - 1]!)).toBeLessThan(0.05);
    }
  });
});
