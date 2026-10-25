/**
 * "Same riff in 3 positions" (phase 6): the written fingering plus up to two clearly different,
 * playable places on the neck for exactly the same pitches. Each becomes a set of position edits
 * that the arrangement applies to its own copy of the score (audio pitches stay identical).
 */
import type { RiffEdit } from './edits';
import { optimizeFingering, type Position } from './fingering';
import { refKey } from './review';
import type { Timeline } from './timeline';

export type PositionPass = { label: string; edits: RiffEdit[]; low: number; high: number; meanFret: number };

const TARGETS = [0, 3, 5, 7, 9, 12, 15];
/** Alternatives must sit at least this many frets (mean) away from every chosen position. */
const MIN_SHIFT = 2.5;

function stats(ps: Position[]): { low: number; high: number; mean: number } {
  const fretted = ps.filter((p) => p.fret > 0).map((p) => p.fret);
  if (!fretted.length) return { low: 0, high: 0, mean: 0 };
  return { low: Math.min(...fretted), high: Math.max(...fretted), mean: fretted.reduce((a, b) => a + b, 0) / fretted.length };
}

function label(prefix: string, low: number, high: number): string {
  return high <= 4 ? `${prefix} · open position` : `${prefix} · frets ${low}–${high}`;
}

export function positionPasses(t: Pick<Timeline, 'events' | 'tuning' | 'capo'>, max = 3): PositionPass[] {
  const written: Position[] = t.events.map((e) => ({ stringIdx: e.stringIdx, fret: e.fret }));
  const w = stats(written);
  const passes: PositionPass[] = [{ label: label('As written', w.low, w.high), edits: [], low: w.low, high: w.high, meanFret: w.mean }];
  const seen = new Set([written.map((p) => `${p.stringIdx}.${p.fret}`).join()]);
  const options = TARGETS.map((targetFret) => optimizeFingering(t, { targetFret }))
    .filter((ps) => {
      const key = ps.map((p) => `${p.stringIdx}.${p.fret}`).join();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((ps) => ({ ps, ...stats(ps) }))
    .sort((a, b) => a.mean - b.mean);
  for (const o of options) {
    if (passes.length >= max) break;
    if (passes.some((p) => Math.abs(p.meanFret - o.mean) < MIN_SHIFT)) continue;
    const edits: RiffEdit[] = [];
    const done = new Set<string>();
    t.events.forEach((e, i) => {
      const p = o.ps[i];
      if (!e.ref || !p || done.has(refKey(e.ref))) return;
      done.add(refKey(e.ref));
      if (p.stringIdx !== e.stringIdx || p.fret !== e.fret) edits.push({ kind: 'position', ref: e.ref, stringIdx: p.stringIdx, fret: p.fret });
    });
    passes.push({ label: '', edits, low: o.low, high: o.high, meanFret: o.mean });
  }
  passes.sort((a, b) => a.meanFret - b.meanFret);
  return passes.map((p, k) => ({ ...p, label: p.edits.length === 0 ? p.label : label(`Position ${k + 1}`, p.low, p.high) }));
}
