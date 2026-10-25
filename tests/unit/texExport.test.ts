import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { riffToAlphaTex } from '../../src/import/texExport';
import { decodePractice, encodePractice, MAX_LINK_CHARS } from '../../src/import/practiceLink';
import type { RiffSource } from '../../src/import/source';

const golden = join(import.meta.dirname, '../golden/riffs');
const notes = (tex: string, track = 0) =>
  buildTimeline(loadAlphaTex(tex), { ...DEFAULT_BUILD, trackIndex: track }).timeline.events.map((e) => [Math.round(e.startMs), e.stringIdx, e.fret, e.midi, [...e.tech].sort().join()]);

describe('riffToAlphaTex (practice links)', () => {
  for (const f of ['01-pentatonic-run.atex', '02-chords.atex', '03-repeats.atex', '04-tempo-ties.atex', '05-techniques.atex']) {
    it(`${f}: round-trips to the same notes, times and techniques`, () => {
      const tex = readFileSync(join(golden, f), 'utf8');
      const out = riffToAlphaTex({ kind: 'alphatex', text: tex }, 0, []);
      expect(notes(out)).toEqual(notes(tex));
    });
  }
  it('applies Riff Review edits and keeps only the guitar track of a Guitar Pro file', () => {
    const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, '../fixtures/alphatab/hammer.gp5')));
    const src: RiffSource = { kind: 'file', bytes, name: 'hammer.gp5' };
    const out = riffToAlphaTex(src, 0, [], 'Hammer');
    expect(out).toContain('Hammer');
    const n = notes(out);
    expect(n.length).toBeGreaterThan(0);
    const edited = riffToAlphaTex({ kind: 'alphatex', text: readFileSync(join(golden, '01-pentatonic-run.atex'), 'utf8') }, 0, [{ kind: 'capo', capo: 2 }]);
    expect(buildTimeline(loadAlphaTex(edited), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline.capo).toBe(2);
  });
});

describe('practice link codec', () => {
  it('round-trips and stays short', async () => {
    const tex = readFileSync(join(golden, '05-techniques.atex'), 'utf8');
    const data = await encodePractice({ title: 'Golden 5', artist: 'me', alphaTex: tex });
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(data.length).toBeLessThan(Math.min(MAX_LINK_CHARS, tex.length * 1.4));
    expect(await decodePractice(data)).toEqual({ v: 1, title: 'Golden 5', artist: 'me', alphaTex: tex });
  });
  it('damaged or foreign links give null, never throw', async () => {
    for (const bad of ['', 'abc', 'not base64 !!', 'AAAAAAAAAAAAAAAA', 'x'.repeat(MAX_LINK_CHARS + 1)]) expect(await decodePractice(bad)).toBeNull();
  });
});
