import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { alphaTabStringToIdx, idxToAlphaTabString } from '../../src/engine/strings';
import { buildTempoSegments, tickToMs } from '../../src/engine/tempo';
import { validateTimeline } from '../../src/engine/timeline';
import { loadAlphaTex, loadScoreFile, ScoreImportError } from '../../src/import/alphatab';

const golden = join(__dirname, '../golden/riffs');
const fixtures = join(__dirname, '../fixtures/alphatab');
const riffs = readdirSync(golden).filter((f) => f.endsWith('.atex')).sort();
const buildTex = (tex: string, leadInMs = 1000) => buildTimeline(loadAlphaTex(tex), { ...DEFAULT_BUILD, leadInMs, trackIndex: 0 });
const buildGolden = (f: string) => buildTex(readFileSync(join(golden, f), 'utf8'));
const buildFile = (f: string) =>
  buildTimeline(loadScoreFile(new Uint8Array(readFileSync(join(fixtures, f))), f), { ...DEFAULT_BUILD, trackIndex: 0 });
const HEAD = '\\tempo 120 \\track "G" \\staff {tabs} \\tuning (E4 B3 G3 D3 A2 E2)\n';

describe('tempo', () => {
  it('matches the sequencer formula, incl. default 120 bpm before the first event', () => {
    const seg = buildTempoSegments([{ tick: 960, bpm: 60 }], 960);
    expect(tickToMs(seg, 960, 960)).toBe(500);
    expect(tickToMs(seg, 960, 1920)).toBe(1500);
    expect(tickToMs(buildTempoSegments([{ tick: 0, bpm: 0 }], 960), 960, 1)).toBe(62.5); // bpm clamped to 1
  });
});

describe('P5 string numbering', () => {
  it('alphaTab string 1 (lowest) ↔ display index 5 on a 6-string', () => {
    expect(alphaTabStringToIdx(1, 6)).toBe(5);
    expect(alphaTabStringToIdx(6, 6)).toBe(0);
    expect(idxToAlphaTabString(alphaTabStringToIdx(3, 7), 7)).toBe(3);
  });

  // alphaTab's own test (GpImporterTestHelper.checkStrings): string 1 → fret 6 … string 6 → fret 1.
  for (const f of ['strings.gp5', 'strings.gp']) {
    it(`${f}: low E carries fret 6, high e fret 1`, () => {
      const { timeline, warnings } = buildFile(f);
      expect(warnings).toEqual([]);
      const byString = Object.fromEntries(timeline.events.map((e) => [e.stringIdx, e.fret]));
      expect(byString).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 });
      expect(timeline.events.find((e) => e.stringIdx === 5)!.midi).toBe(46);
    });
  }

  it('alphaTex 0.6 is the low E string', () => {
    const e = buildTex(HEAD + ':4 0.6 3.1').timeline.events;
    expect(e.map((x) => [x.stringIdx, x.midi])).toEqual([[5, 40], [0, 67]]);
  });
});

describe('Guitar Pro import', () => {
  it('gp5 notes file: whole notes at 120 bpm last 2 s, all on low E', () => {
    const { timeline, warnings } = buildFile('notes.gp5');
    expect(warnings).toEqual([]);
    expect(timeline.events[0]).toMatchObject({ startMs: 1000, durationMs: 2000, stringIdx: 5, fret: 1 });
    expect(validateTimeline(timeline)).toEqual([]);
  });

  it('gp5 alternate endings expand to play order', () => {
    const { timeline } = buildFile('repeat-close-alternate-endings.gp5');
    expect(timeline.bars.map((b) => b.index)).toEqual([0, 1, 0, 2, 3, 0, 1, 0, 4]);
  });

  it('rejects garbage with a readable error', () => {
    expect(() => loadScoreFile(new Uint8Array([1, 2, 3]), 'x.gp5')).toThrow(ScoreImportError);
  });
});

describe('buildTimeline', () => {
  it('applies lead-in once', () => {
    const a = buildTex(HEAD + ':4 0.6', 0).timeline;
    const b = buildTex(HEAD + ':4 0.6', 2000).timeline;
    expect(b.events[0]!.startMs - a.events[0]!.startMs).toBe(2000);
    expect(b.bars[0]!.startMs).toBe(2000);
  });

  it('expands repeats (×3)', () => {
    const { timeline } = buildTex(HEAD + '\\ro \\rc 3 :4 1.6 2.6 3.6 4.6');
    expect(timeline.events).toHaveLength(12);
    expect(timeline.events[4]!.startMs).toBe(1000 + 2000);
    expect(new Set(timeline.events.map((e) => e.id)).size).toBe(12);
  });

  it('ties extend the struck note instead of re-striking', () => {
    const { timeline } = buildTex(HEAD + ':4 5.2 -.2 :2 r');
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]!.durationMs).toBe(1000);
  });

  it('tempo changes move later notes', () => {
    const { timeline } = buildTex(HEAD + ':4 1.1 r r r | \\tempo 60 :4 1.1 1.1 r r');
    expect(timeline.events.map((e) => e.startMs)).toEqual([1000, 3000, 4000]);
    expect(timeline.tempoMap.at(-1)).toEqual({ ms: 3000, bpm: 60 });
  });

  it('chord notes share a chordId and start', () => {
    const { timeline } = buildTex(HEAD + ':4 (0.6 2.5 2.4) 3.1');
    const chord = timeline.events.filter((e) => e.chordId);
    expect(chord).toHaveLength(3);
    expect(new Set(chord.map((e) => e.chordId)).size).toBe(1);
    expect(timeline.events.at(-1)!.chordId).toBeUndefined();
  });

  it('fills in computed fingers; open strings have none', () => {
    const e = buildTex(HEAD + ':8 5.6 7.6 8.6 0.5').timeline.events;
    expect(e.map((x) => x.finger)).toEqual([1, 3, 4, undefined]);
  });

  it('capo is included in midi', () => {
    const { timeline, warnings } = buildTex(HEAD.replace('\\staff', '\\capo 3 \\staff') + ':4 0.6');
    expect(warnings).toEqual([]);
    expect(timeline).toMatchObject({ capo: 3, events: [{ midi: 43 }] });
  });

  it('maps techniques; slide destination is legato (no new attack)', () => {
    const { timeline } = buildTex(HEAD + ':8 5.3{h} 7.3 7.3{h} 5.3 5.2{sl} 8.2 7.3{b (0 4)} 0.6{pm}');
    const t = timeline.events.map((e) => [e.fret, e.tech.join('+'), e.legato ?? false]);
    expect(t).toEqual([
      [5, '', false],
      [7, 'hammer', false],
      [7, '', false],
      [5, 'pull', false],
      [5, 'slide', false],
      [8, 'slide', true],
      [7, 'bend', false],
      [0, 'palmMute', false],
    ]);
    expect(timeline.events[6]!.bendSemitones).toBe(2);
  });

  it('reports alphaTex errors with line numbers', () => {
    try {
      loadAlphaTex(HEAD + ':4 0.6{nope}');
      expect.unreachable();
    } catch (e) {
      expect((e as ScoreImportError).details.join()).toMatch(/Line 2/);
    }
  });
});

describe('golden riffs build cleanly', () => {
  it('has 5 golden riffs', () => expect(riffs).toHaveLength(5));
  for (const f of riffs) {
    it(f, () => {
      const { timeline, warnings } = buildGolden(f);
      expect(warnings).toEqual([]);
      expect(validateTimeline(timeline)).toEqual([]);
    });
  }
});

describe('demo riffs build cleanly', () => {
  const demos = join(__dirname, '../../src/demo');
  for (const f of readdirSync(demos).filter((x) => x.endsWith('.atex'))) {
    it(f, () => {
      const { timeline, warnings } = buildTex(readFileSync(join(demos, f), 'utf8'));
      expect(warnings).toEqual([]);
      expect(validateTimeline(timeline)).toEqual([]);
    });
  }
});
