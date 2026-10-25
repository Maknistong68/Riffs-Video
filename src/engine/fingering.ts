/**
 * P4: the same pitch can be played in several places. Dynamic programming (Viterbi) over
 * every playable string/fret assignment per slot (single note or chord), minimising hand
 * movement under a 4-fret span limit. Also assigns display fingers for a fixed fingering.
 */
import { MAX_FRET, type NoteEvent, type Timeline } from './timeline';

export type Position = { stringIdx: number; fret: number };
type Slot = { events: NoteEvent[] };
type Candidate = { positions: Position[]; low: number | null; high: number | null; meanString: number; changed: number };

/** Max distance between lowest and highest fretted note in one hand shape (4 frets: e.g. 5–8). */
export const MAX_SPAN = 3;
/** Absolute stretch limit; shapes between MAX_SPAN and this are penalised. */
const HARD_SPAN = 4;
const LEGATO: NoteEvent['tech'][number][] = ['hammer', 'pull', 'slide'];
/** Cost of moving a note away from where it is written: only clearly better fingerings win. */
const CHANGE_COST = 0.6;

/** Notes struck together (same start) form one slot. */
export function slots(t: Pick<Timeline, 'events'>): Slot[] {
  const out: Slot[] = [];
  for (const e of t.events) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.events[0]!.startMs - e.startMs) < 1) last.events.push(e);
    else out.push({ events: [e] });
  }
  return out;
}

export function positionsFor(midi: number, tuning: readonly number[], capo: number, maxFret = MAX_FRET): Position[] {
  const out: Position[] = [];
  tuning.forEach((open, stringIdx) => {
    const fret = midi - open - capo;
    if (fret >= 0 && fret <= maxFret) out.push({ stringIdx, fret });
  });
  return out;
}

function candidates(slot: Slot, tuning: readonly number[], capo: number): Candidate[] {
  const perNote = slot.events.map((e) =>
    // Pitchless / harmonic notes keep their written place.
    e.tech.includes('dead') || e.tech.includes('harmonic') ? [{ stringIdx: e.stringIdx, fret: e.fret }] : positionsFor(e.midi, tuning, capo),
  );
  const out: Candidate[] = [];
  const pick: Position[] = [];
  const rec = (i: number) => {
    if (out.length > 400) return;
    if (i === perNote.length) {
      const fretted = pick.filter((p) => p.fret > 0).map((p) => p.fret);
      const low = fretted.length ? Math.min(...fretted) : null;
      const high = fretted.length ? Math.max(...fretted) : null;
      if (low !== null && high! - low > HARD_SPAN) return;
      const changed = pick.filter((p, k) => p.stringIdx !== slot.events[k]!.stringIdx).length;
      out.push({ positions: [...pick], low, high, meanString: pick.reduce((s, p) => s + p.stringIdx, 0) / pick.length, changed });
      return;
    }
    for (const p of perNote[i]!) {
      if (pick.some((q) => q.stringIdx === p.stringIdx)) continue;
      pick.push(p);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  // Unplayable chord in this tuning: keep what is written.
  if (out.length === 0) {
    const positions = slot.events.map((e) => ({ stringIdx: e.stringIdx, fret: e.fret }));
    const fretted = positions.filter((p) => p.fret > 0).map((p) => p.fret);
    out.push({ positions, low: fretted.length ? Math.min(...fretted) : null, high: fretted.length ? Math.max(...fretted) : null, meanString: 0, changed: 0 });
  }
  return out;
}

function shapeCost(c: Candidate): number {
  let cost = CHANGE_COST * c.changed;
  if (c.low !== null) {
    cost += 0.04 * c.low; // slight preference for lower positions
    if (c.high! - c.low > MAX_SPAN) cost += 3; // stretch
  }
  return cost;
}

function moveCost(a: Candidate, b: Candidate, hand: number | null): number {
  // Open strings don't move the hand; compare fretted shapes against where the hand is.
  let cost = 0;
  if (b.low !== null && hand !== null) {
    if (b.low < hand) cost += hand - b.low;
    else if (b.high! > hand + MAX_SPAN) cost += b.high! - (hand + MAX_SPAN);
  }
  cost += 0.15 * Math.abs(a.meanString - b.meanString);
  return cost;
}

/** Best playable positions for every event (same order as timeline.events). */
export function optimizeFingering(t: Pick<Timeline, 'events' | 'tuning' | 'capo'>): Position[] {
  const ss = slots(t);
  if (ss.length === 0) return [];
  const cands = ss.map((s) => candidates(s, t.tuning, t.capo));
  // dp[i][k] = best cost ending in candidate k of slot i; hand[i][k] = index-finger fret afterwards.
  let prevCost = cands[0]!.map(shapeCost);
  let prevHand = cands[0]!.map((c) => c.low);
  const back: number[][] = [cands[0]!.map(() => -1)];
  for (let i = 1; i < ss.length; i++) {
    const cost: number[] = [];
    const hand: (number | null)[] = [];
    const bp: number[] = [];
    const legatoSingle = ss[i]!.events.length === 1 && ss[i]!.events[0]!.tech.some((x) => LEGATO.includes(x));
    for (const c of cands[i]!) {
      let best = Infinity;
      let arg = 0;
      for (let k = 0; k < cands[i - 1]!.length; k++) {
        const p = cands[i - 1]![k]!;
        // Hammer/pull/slide must stay on the string of the previous note.
        if (legatoSingle && p.positions.length === 1 && p.positions[0]!.stringIdx !== c.positions[0]!.stringIdx) continue;
        const v = prevCost[k]! + moveCost(p, c, prevHand[k] ?? null);
        if (v < best) {
          best = v;
          arg = k;
        }
      }
      if (!Number.isFinite(best)) {
        best = 1000;
        arg = 0;
      }
      cost.push(best + shapeCost(c));
      bp.push(arg);
      const ph = prevHand[arg] ?? null;
      hand.push(c.low === null ? ph : ph !== null && c.low >= ph && c.high! <= ph + MAX_SPAN ? ph : c.low);
    }
    prevCost = cost;
    prevHand = hand;
    back.push(bp);
  }
  let k = prevCost.indexOf(Math.min(...prevCost));
  const chosen: Candidate[] = new Array(ss.length);
  for (let i = ss.length - 1; i >= 0; i--) {
    chosen[i] = cands[i]![k]!;
    k = back[i]![k]!;
  }
  return chosen.flatMap((c) => c.positions);
}

/** Display fingers for the given positions: one finger per fret from the current hand position. */
export function assignFingers(t: Pick<Timeline, 'events'>): NoteEvent['finger'][] {
  const ss = slots(t);
  const frets = ss.map((s) => s.events.filter((e) => e.fret > 0).map((e) => e.fret));
  const out: NoteEvent['finger'][] = [];
  let hand: number | null = null;
  for (let i = 0; i < ss.length; i++) {
    const f = frets[i]!;
    if (f.length) {
      const low = Math.min(...f);
      const high = Math.max(...f);
      if (hand === null || low < hand || high > hand + MAX_SPAN) {
        // Look ahead: put the index finger where this and the following notes fit.
        let lo = low;
        let hi = high;
        for (let j = i + 1; j < ss.length; j++) {
          const g = frets[j]!;
          if (!g.length) continue;
          const nlo = Math.min(lo, ...g);
          const nhi = Math.max(hi, ...g);
          if (nhi - nlo > MAX_SPAN) break;
          lo = nlo;
          hi = nhi;
        }
        hand = high - low > MAX_SPAN ? low : Math.min(low, Math.max(lo, high - MAX_SPAN));
      }
    }
    for (const e of ss[i]!.events) {
      if (e.finger !== undefined) out.push(e.finger);
      else if (e.fret === 0 || hand === null) out.push(undefined);
      else out.push(Math.max(1, Math.min(4, e.fret - hand + 1)) as 1 | 2 | 3 | 4);
    }
  }
  return out;
}
