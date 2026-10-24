import type { Timeline } from '../engine/timeline';

export type OnsetMatch = {
  eventId: string;
  expectedMs: number;
  detectedMs: number | null;
  errorMs: number | null;
  ok: boolean;
};

export type SyncReport = {
  ok: boolean;
  toleranceMs: number;
  matched: number;
  total: number;
  extraOnsets: number[];
  matches: OnsetMatch[];
  maxAbsErrorMs: number;
  durations: { videoSec: number; audioSec: number; diffMs: number; ok: boolean } | null;
  highlights: { eventId: string; frame: number; ok: boolean; detail: string }[];
};

/**
 * Match detected onsets to timeline note starts (chord notes share one onset).
 * Each onset is used at most once; anything farther than `toleranceMs` is a miss.
 */
export function matchOnsets(t: Timeline, onsetsMs: readonly number[], toleranceMs: number): {
  matches: OnsetMatch[];
  extraOnsets: number[];
} {
  const used = new Set<number>();
  const matches: OnsetMatch[] = [];
  const groupOnset = new Map<string, number>();
  for (const e of t.events) {
    const key = e.chordId ?? `@${e.startMs}`;
    let idx = groupOnset.get(key);
    if (idx === undefined) {
      let best = -1;
      let bestErr = Infinity;
      for (let i = 0; i < onsetsMs.length; i++) {
        if (used.has(i)) continue;
        const err = Math.abs(onsetsMs[i]! - e.startMs);
        if (err < bestErr) {
          bestErr = err;
          best = i;
        }
      }
      idx = best >= 0 && bestErr <= toleranceMs ? best : -1;
      if (idx >= 0) used.add(idx);
      groupOnset.set(key, idx);
    }
    const detected = idx >= 0 ? onsetsMs[idx]! : null;
    matches.push({
      eventId: e.id,
      expectedMs: e.startMs,
      detectedMs: detected,
      errorMs: detected === null ? null : detected - e.startMs,
      ok: detected !== null,
    });
  }
  const extraOnsets = onsetsMs.filter((_, i) => !used.has(i));
  return { matches, extraOnsets };
}
