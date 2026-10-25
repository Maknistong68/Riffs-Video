/**
 * P1: give rhythm to notes that have none (text tabs, taps, transcribed audio).
 * Onset times → tempo + durations on a 16th-note grid. Pure.
 */

export const UNITS_PER_BEAT = 4; // 16th-note grid
export const UNITS_PER_BAR = 16; // 4/4

export type Quantized = {
  bpm: number;
  /** Duration of each onset in 16ths (last one from endMs or a sensible default). */
  units: number[];
  /** RMS timing error of the fit in ms (how well the grid explains the onsets). */
  errorMs: number;
};

/** How "natural" a note value is: eighths/quarters/halves are cheap, odd 16th lengths dear. */
function unitCost(u: number): number {
  if (u === 2 || u === 4 || u === 8 || u === 16) return 0;
  if (u === 1 || u === 6 || u === 12 || u === 3) return 1;
  return 2;
}

export type QuantizeOptions = { endMs?: number; minBpm?: number; maxBpm?: number; preferBpm?: number };

/**
 * Pick the tempo whose 16th grid explains the onsets best, trading timing error against
 * rhythmic complexity and a mild tempo prior (resolves the classic 2× tempo ambiguity).
 */
export function quantizeOnsets(onsetsMs: readonly number[], opts: QuantizeOptions = {}): Quantized {
  const n = onsetsMs.length;
  if (n === 0) return { bpm: opts.preferBpm ?? 100, units: [], errorMs: 0 };
  if (n === 1) return { bpm: opts.preferBpm ?? 100, units: [4], errorMs: 0 };
  const t0 = onsetsMs[0]!;
  const minBpm = opts.minBpm ?? 50;
  const maxBpm = opts.maxBpm ?? 220;
  const prefer = opts.preferBpm ?? 105;
  let best: { score: number; bpm: number; q: number[]; err: number } | null = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const g = 60_000 / bpm / UNITS_PER_BEAT;
    const q: number[] = [];
    let se = 0;
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const p = (onsetsMs[i]! - t0) / g;
      let qi = Math.round(p);
      if (i > 0 && qi <= q[i - 1]!) qi = q[i - 1]! + 1;
      q.push(qi);
      se += ((p - qi) * g) ** 2;
      if (i > 0) cost += unitCost(qi - q[i - 1]!);
    }
    const err = Math.sqrt(se / n);
    const score = err + (8 * cost) / (n - 1) + 14 * Math.abs(Math.log2(bpm / prefer));
    if (!best || score < best.score) best = { score, bpm, q, err };
  }
  const { bpm, q, err } = best!;
  const g = 60_000 / bpm / UNITS_PER_BEAT;
  const units = q.slice(1).map((v, i) => v - q[i]!);
  const lastUnits = opts.endMs !== undefined ? Math.max(1, Math.round((opts.endMs - onsetsMs[n - 1]!) / g)) : Math.max(2, units[units.length - 1] ?? 4);
  units.push(lastUnits);
  return { bpm: Math.round(bpm * 4) / 4, units, errorMs: err };
}

/** Tap tempo: beat taps → BPM (median interval, robust to one stray tap). */
export function tapTempo(tapsMs: readonly number[]): number | null {
  if (tapsMs.length < 3) return null;
  const d = tapsMs.slice(1).map((t, i) => t - tapsMs[i]!).sort((a, b) => a - b);
  const median = d[d.length >> 1]!;
  return Math.round((60_000 / median) * 4) / 4;
}

/** alphaTex note values in 16ths (duration value, dotted). Largest first. */
const VALUES: { units: number; duration: 1 | 2 | 4 | 8 | 16; dotted: boolean }[] = [
  { units: 16, duration: 1, dotted: false },
  { units: 12, duration: 2, dotted: true },
  { units: 8, duration: 2, dotted: false },
  { units: 6, duration: 4, dotted: true },
  { units: 4, duration: 4, dotted: false },
  { units: 3, duration: 8, dotted: true },
  { units: 2, duration: 8, dotted: false },
  { units: 1, duration: 16, dotted: false },
];

export type Piece = { duration: 1 | 2 | 4 | 8 | 16; dotted: boolean; units: number };

/**
 * Split a note of `units` starting at grid position `pos` into notatable pieces, breaking at
 * bar lines (the caller ties pieces 2…n to the first).
 */
export function splitDuration(pos: number, units: number, unitsPerBar = UNITS_PER_BAR): Piece[] {
  const out: Piece[] = [];
  let p = pos;
  let left = units;
  while (left > 0) {
    const toBar = unitsPerBar - (p % unitsPerBar);
    const seg = Math.min(left, toBar);
    let rest = seg;
    while (rest > 0) {
      const v = VALUES.find((x) => x.units <= rest)!;
      out.push({ duration: v.duration, dotted: v.dotted, units: v.units });
      rest -= v.units;
    }
    p += seg;
    left -= seg;
  }
  return out;
}

/**
 * Tempo of a song from its onsets (for Silent mode alignment): every pair of onsets votes for
 * the beat periods it could be a multiple of; the 70–180 bpm candidate with most support wins.
 */
export function estimateBpm(onsetsMs: readonly number[], minBpm = 70, maxBpm = 180): number | null {
  if (onsetsMs.length < 8) return null;
  let best: { bpm: number; score: number } | null = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const beat = 60_000 / bpm;
    let score = 0;
    for (let i = 0; i < onsetsMs.length; i++) {
      for (let j = i + 1; j < onsetsMs.length && onsetsMs[j]! - onsetsMs[i]! < 4 * beat; j++) {
        const d = (onsetsMs[j]! - onsetsMs[i]!) / (beat / 2); // in eighth-note units
        const err = Math.abs(d - Math.round(d));
        if (Math.round(d) >= 1 && err < 0.08) score += (Math.round(d) % 2 === 0 ? 1 : 0.5) * (1 - err / 0.08);
      }
    }
    if (!best || score > best.score) best = { bpm, score };
  }
  return best ? Math.round(best.bpm * 4) / 4 : null;
}
