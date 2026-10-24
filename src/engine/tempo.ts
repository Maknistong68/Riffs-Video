/**
 * Tick → ms conversion that reproduces alphaTab's MidiFileSequencer exactly:
 *   time += deltaTick * 60000 / (bpm * division), bpm = max(bpm, 1), starting at 120 bpm.
 * The synth renders audio with that sequencer, so visuals computed here cannot drift from it.
 */

export type TempoSegment = { tick: number; ms: number; bpm: number };

export type TempoEvent = { tick: number; bpm: number };

const DEFAULT_BPM = 120;

export function buildTempoSegments(events: readonly TempoEvent[], division: number): TempoSegment[] {
  const segments: TempoSegment[] = [{ tick: 0, ms: 0, bpm: DEFAULT_BPM }];
  for (const e of [...events].sort((a, b) => a.tick - b.tick)) {
    const last = segments[segments.length - 1]!;
    const ms = last.ms + ((e.tick - last.tick) * 60_000) / (last.bpm * division);
    const bpm = Math.max(e.bpm, 1);
    if (e.tick === last.tick) segments[segments.length - 1] = { tick: e.tick, ms: last.ms, bpm };
    else segments.push({ tick: e.tick, ms, bpm });
  }
  return segments;
}

export function tickToMs(segments: readonly TempoSegment[], division: number, tick: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (segments[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const s = segments[lo]!;
  return s.ms + ((tick - s.tick) * 60_000) / (s.bpm * division);
}
