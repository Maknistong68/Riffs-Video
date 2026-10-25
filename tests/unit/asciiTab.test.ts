import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { AsciiTabError, looksLikeAsciiTab, parseAsciiTab, spacingRhythm, type AsciiNote } from '../../src/import/asciiTab';
import { asciiToAlphaTex } from '../../src/import/asciiToAlphaTex';

const dir = join(__dirname, '../fixtures/ascii');
type Expected = { tuning: number[]; capo: number; columns: (number | string)[][][] };
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Record<string, Expected>;
const files = Object.keys(expected).filter((k) => k.endsWith('.txt'));

function flags(n: AsciiNote): string | undefined {
  const f = [
    n.hammerToNext && 'h',
    n.slideToNext && 'sl',
    n.bendSemitones && `b${n.bendSemitones}${n.release ? 'r' : ''}`,
    n.vibrato && 'v',
    n.palmMute && 'pm',
    n.harmonic && 'nh',
    n.dead && 'x',
  ].filter(Boolean);
  return f.length ? f.join(',') : undefined;
}

describe('10 test ASCII tabs parse to the expected note lists', () => {
  it('has 10 fixtures', () => expect(files).toHaveLength(10));
  for (const f of files) {
    it(f, () => {
      const p = parseAsciiTab(readFileSync(join(dir, f), 'utf8'));
      const got = p.columns.map((c) => c.notes.map((n) => (flags(n) ? [n.stringIdx, n.fret, flags(n)!] : [n.stringIdx, n.fret])));
      expect({ tuning: p.tuning, capo: p.capo, columns: got }).toEqual(expected[f]);
    });
  }
});

describe('parser details', () => {
  it('rejects text without tab', () => {
    expect(() => parseAsciiTab('just some lyrics\nand chords C G Am')).toThrow(AsciiTabError);
  });
  it('detects bar lines before columns', () => {
    const p = parseAsciiTab(readFileSync(join(dir, '03-chords.txt'), 'utf8'));
    expect(p.columns.map((c) => c.barBefore)).toEqual([false, false, true]);
  });
  it('guesses rhythm from spacing (typical gap = eighth)', () => {
    const p = parseAsciiTab('e|-0-0---0-------|\nB|---------------|\nG|---------------|\nD|---------------|');
    expect(spacingRhythm(p.columns)).toEqual([2, 4, 4]);
  });
  it('reads drop D from text when lines have no labels', () => {
    const p = parseAsciiTab('Tuning: Drop D\n|-----|\n|-----|\n|-----|\n|-----|\n|-----|\n|--0--|');
    expect(p.tuning).toEqual([64, 59, 55, 50, 45, 38]);
    expect(p.tuningSource).toBe('text');
  });
});

describe('every fixture converts to a valid alphaTab score', () => {
  for (const f of files) {
    it(f, () => {
      const p = parseAsciiTab(readFileSync(join(dir, f), 'utf8'));
      const { text, refs } = asciiToAlphaTex(p, { title: f, bpm: 100, units: spacingRhythm(p.columns) });
      const { timeline, warnings } = buildTimeline(loadAlphaTex(text), { ...DEFAULT_BUILD, trackIndex: 0 });
      expect(warnings).toEqual([]);
      expect(validateTimeline(timeline)).toEqual([]);
      // Same notes (string, fret) in the same order as parsed.
      const parsed = p.columns.flatMap((c) => c.notes.map((n) => `${n.stringIdx}:${n.fret}`));
      const built = timeline.events.filter((e) => !e.legato || true).map((e) => `${e.stringIdx}:${e.fret}`);
      expect(built).toEqual(parsed);
      expect(refs.flat().filter(Boolean)).toHaveLength(parsed.length);
    });
  }
});

describe('looksLikeAsciiTab (text tab pasted into the alphaTex editor)', () => {
  it('spots a text tab, also after a header', () => {
    expect(looksLikeAsciiTab(readFileSync(join(dir, '01-basic.txt'), 'utf8'))).toBe(true);
    expect(looksLikeAsciiTab('Song: x\nTuning: B D D D D D\n\nD|--0--0-|\nD|--0--0-|\nD|--0--0-|\nD|--12-11|\nD|-------|\nB|-------|')).toBe(true);
  });
  it('does not flag alphaTex', () => {
    expect(looksLikeAsciiTab('\\title "My Riff"\n\\tempo 100\n.\n:8 0.6 3.6 0.5 2.5 0.4 2.4 :4 0.3 |\n:8 2.3 0.4 2.5{h} 3.5 :2 0.6')).toBe(false);
    expect(looksLikeAsciiTab('')).toBe(false);
  });
});
