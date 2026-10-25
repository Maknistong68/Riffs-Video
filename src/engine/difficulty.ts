/** Difficulty estimate (for the badge suggestion and "loop hardest bar"). Pure. */
import type { Timeline } from './timeline';

export type BarDifficulty = { playIndex: number; barIndex: number; startMs: number; endMs: number; score: number };
export type DifficultyLabel = 'Easy' | 'Medium' | 'Hard';

const TECH_WEIGHT: Record<string, number> = { bend: 1.2, release: 1.2, slide: 0.8, hammer: 0.6, pull: 0.6, vibrato: 0.5, harmonic: 0.8, palmMute: 0.2, dead: 0.2, tieContinue: 0 };

export function barDifficulties(t: Timeline): BarDifficulty[] {
  const lastEnd = Math.max(t.leadInMs, ...t.events.map((e) => e.startMs + e.durationMs));
  return t.bars.map((b, i) => {
    const endMs = t.bars[i + 1]?.startMs ?? lastEnd;
    const ev = t.events.filter((e) => e.startMs >= b.startMs && e.startMs < endMs);
    const struck = [...new Set(ev.filter((e) => !e.legato).map((e) => Math.round(e.startMs)))].length;
    const secs = Math.max(0.25, (endMs - b.startMs) / 1000);
    let jumps = 0;
    let prevFret: number | null = null;
    for (const e of ev) {
      if (e.fret > 0) {
        if (prevFret !== null) jumps += Math.abs(e.fret - prevFret);
        prevFret = e.fret;
      }
    }
    const tech = ev.reduce((s, e) => s + e.tech.reduce((a, x) => a + (TECH_WEIGHT[x] ?? 0), 0), 0);
    const chords = new Set(ev.filter((e) => e.chordId).map((e) => e.chordId)).size;
    const score = struck / secs + (0.35 * jumps) / secs + (0.6 * tech) / secs + (0.5 * chords) / secs;
    return { playIndex: i, barIndex: b.index, startMs: b.startMs, endMs, score };
  });
}

export function hardestBar(t: Timeline): BarDifficulty | null {
  const bars = barDifficulties(t).filter((b) => b.score > 0);
  if (bars.length === 0) return null;
  return bars.reduce((best, b) => (b.score > best.score + 1e-9 ? b : best));
}

export function difficultyLabel(t: Timeline): DifficultyLabel {
  const bars = barDifficulties(t).filter((b) => b.score > 0);
  if (bars.length === 0) return 'Easy';
  const top = Math.max(...bars.map((b) => b.score));
  return top < 4 ? 'Easy' : top < 8 ? 'Medium' : 'Hard';
}
