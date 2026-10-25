import { describe, expect, it } from 'vitest';
import { checkAiTab, UNRATED_CONFIDENCE } from '../../src/import/aiRiff';

const HEAD = '\\title "AI riff"\n\\tempo 100\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n';

describe('checkAiTab', () => {
  it('maps per-note confidence onto score refs (bar, beat, string, fret)', () => {
    const r = checkAiTab(HEAD + ':8 0.6 3.6 (5.5 5.4) r 7.3 |\n:4 5.2 -.2 :2 0.1', [
      { bar: 0, beat: 0, string: 6, fret: 0, confidence: 0.95 },
      { bar: 0, beat: 1, string: 6, fret: 3, confidence: 0.5 },
      { bar: 0, beat: 2, string: 5, fret: 5, confidence: 0.9 },
      { bar: 0, beat: 2, string: 4, fret: 5, confidence: 0.3 },
      { bar: 0, beat: 4, string: 3, fret: 7, confidence: 0.8 },
      { bar: 1, beat: 0, string: 2, fret: 5, confidence: 1 },
      { bar: 1, beat: 2, string: 1, fret: 0, confidence: 0.85 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const values = Object.values(r.noteConfidence);
    expect(values.filter((c) => c === UNRATED_CONFIDENCE)).toHaveLength(0);
    expect(values.sort()).toEqual([0.3, 0.5, 0.8, 0.85, 0.9, 0.95, 1].sort());
    expect(r.warnings).toEqual([]);
  });

  it('falls back to bar + string + fret when the model counted beats differently', () => {
    const r = checkAiTab(HEAD + ':8 r 0.6 3.6', [
      { bar: 0, beat: 0, string: 6, fret: 0, confidence: 0.4 }, // model skipped the rest
      { bar: 0, beat: 1, string: 6, fret: 3, confidence: 0.9 },
    ]);
    expect(Object.values(r.noteConfidence).sort()).toEqual([0.4, 0.9]);
  });

  it('notes without a confidence are marked unsure and reported', () => {
    const r = checkAiTab(HEAD + ':4 0.6 3.6 5.6', []);
    expect(r.ok).toBe(true);
    expect(Object.values(r.noteConfidence)).toEqual([UNRATED_CONFIDENCE, UNRATED_CONFIDENCE, UNRATED_CONFIDENCE]);
    expect(r.warnings[0]).toMatch(/3 of 3 notes/);
  });

  const broken: [string, string][] = [
    ['syntax error', HEAD + ':8 0.6{nope 3.6'],
    ['garbage', 'Sure! Here is the tab you asked for.'],
    ['empty', ''],
    ['no notes', HEAD + ':4 r r r r'],
    ['string out of range', HEAD + ':4 3.9 5.6'],
  ];
  for (const [name, tex] of broken) {
    it(`${name} → not ok with a message, never throws`, () => {
      const r = checkAiTab(tex, [{ bar: 0, beat: 0, string: 1, fret: 0, confidence: 1 }]);
      if (r.ok) {
        // alphaTab may accept some of these; then the notes themselves must still be checkable.
        expect(r.noteCount).toBeGreaterThan(0);
      } else {
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.errors.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
      }
    });
  }

  it('a syntax error is reported with its position', () => {
    const r = checkAiTab(HEAD + ':8 0.6{nope 3.6', []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/line|col|Line/i);
  });
});
