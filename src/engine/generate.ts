/**
 * Original riff generator (phase 6) — copyright-safe by construction: notes come from a scale,
 * a rhythm template and a seeded random walk, never from a song. Deterministic for a seed, so
 * "riff of the day" is the same riff for everyone on that date. Output is alphaTex, which goes
 * through the normal alphaTab → Timeline → Riff Review path.
 */
import { writeAlphaTex, type WriterColumn, type WriterNote } from '../import/alphatexWriter';

export type GenGenre = 'rock' | 'metal' | 'blues' | 'funk' | 'lofi' | 'acoustic';
export type GenDifficulty = 'easy' | 'medium' | 'hard';
export type GenOptions = { genre: GenGenre; difficulty: GenDifficulty; bars: 2 | 4; seed: number; bpm?: number };
export type GeneratedRiff = { title: string; alphaTex: string; bpm: number; key: string; scale: string; tuning: number[]; genre: GenGenre };

export const GEN_GENRES: { id: GenGenre; name: string }[] = [
  { id: 'rock', name: 'Rock' },
  { id: 'metal', name: 'Metal' },
  { id: 'blues', name: 'Blues' },
  { id: 'funk', name: 'Funk' },
  { id: 'lofi', name: 'Lo-fi' },
  { id: 'acoustic', name: 'Acoustic' },
];

const STANDARD = [64, 59, 55, 50, 45, 40];
const DROP_D = [64, 59, 55, 50, 45, 38];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scale intervals (semitones above the root). */
const SCALES: Record<string, number[]> = {
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
};

const GENRE: Record<GenGenre, { scales: string[]; keys: number[]; bpm: [number, number]; drop?: boolean }> = {
  rock: { scales: ['minor pentatonic'], keys: [4, 9, 2, 7], bpm: [96, 132] },
  metal: { scales: ['phrygian', 'minor pentatonic'], keys: [4, 2], bpm: [110, 144], drop: true },
  blues: { scales: ['blues'], keys: [4, 9, 7], bpm: [70, 96] },
  funk: { scales: ['dorian', 'minor pentatonic'], keys: [4, 9, 2], bpm: [92, 112] },
  lofi: { scales: ['dorian', 'major pentatonic'], keys: [0, 7, 2, 9], bpm: [70, 88] },
  acoustic: { scales: ['major pentatonic'], keys: [7, 2, 9, 0], bpm: [84, 110] },
};

/** Onsets per bar on the 16th grid (0..15) for each genre and difficulty; durations run to the next onset. */
const RHYTHMS: Record<GenGenre, Record<GenDifficulty, number[][]>> = {
  rock: { easy: [[0, 4, 8, 12], [0, 2, 4, 8, 12]], medium: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 3, 4, 6, 8, 10, 12]], hard: [[0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14], [0, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14]] },
  metal: { easy: [[0, 2, 4, 6, 8, 10, 12, 14]], medium: [[0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 14], [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14]], hard: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]] },
  blues: { easy: [[0, 6, 8, 12], [0, 4, 8, 12]], medium: [[0, 3, 6, 8, 11, 12], [0, 2, 4, 6, 8, 12]], hard: [[0, 2, 3, 4, 6, 8, 10, 11, 12, 14]] },
  funk: { easy: [[0, 3, 6, 8, 12]], medium: [[0, 3, 6, 7, 10, 12, 14], [0, 2, 3, 6, 8, 11, 14]], hard: [[0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15]] },
  lofi: { easy: [[0, 4, 8, 12], [0, 6, 8, 12]], medium: [[0, 2, 4, 6, 8, 12], [0, 3, 6, 8, 10, 12]], hard: [[0, 2, 3, 4, 6, 8, 10, 11, 12, 14]] },
  acoustic: { easy: [[0, 4, 8, 12]], medium: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 4, 6, 8, 11, 12, 14]], hard: [[0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]] },
};

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same number for everyone on the same calendar day. */
export function riffOfTheDaySeed(d: Date): number {
  const s = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Today's riff: genre and seed from the date, medium, 4 bars. */
export function riffOfTheDay(d: Date): GenOptions {
  const seed = riffOfTheDaySeed(d);
  return { genre: GEN_GENRES[seed % GEN_GENRES.length]!.id, difficulty: 'medium', bars: 4, seed };
}

type Spot = { stringIdx: number; fret: number; midi: number };

export function generateRiff(o: GenOptions): GeneratedRiff {
  const rnd = prng(o.seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const g = GENRE[o.genre];
  const scaleName = pick(g.scales);
  const scale = SCALES[scaleName]!;
  const keyPc = pick(g.keys);
  const tuning = g.drop && rnd() < 0.5 ? DROP_D : STANDARD;
  const rhythms = RHYTHMS[o.genre][o.difficulty];
  // 16th notes stay ≥ 125 ms long: faster than that, attacks on the low strings smear together and the
  // Sync Report can't confirm every note (a user-chosen tempo is kept as asked).
  const maxBpm = rhythms.some((r) => r.some((x, k) => (r[k + 1] ?? 16) - x === 1)) ? 120 : g.bpm[1];
  const bpm = o.bpm ?? Math.round((g.bpm[0] + rnd() * (Math.min(g.bpm[1], maxBpm) - g.bpm[0])) / 2) * 2;

  // Hand position: the root on the low string (open position when it's the open string).
  const lowOpen = tuning[tuning.length - 1]!;
  let root = (((keyPc - lowOpen) % 12) + 12) % 12;
  if (root > 9) root -= 12;
  const from = Math.max(0, root);
  const span = o.difficulty === 'easy' ? 3 : 4;
  const inScale = (midi: number) => scale.includes((((midi - keyPc) % 12) + 12) % 12);
  const spots: Spot[] = [];
  for (let s = tuning.length - 1; s >= 0; s--) {
    for (let f = from === 0 ? 0 : from; f <= from + span; f++) {
      const midi = tuning[s]! + f;
      if (inScale(midi)) spots.push({ stringIdx: s, fret: f, midi });
    }
  }
  // One place per pitch (the lower string wins: keeps runs in one box), sorted low → high.
  const byPitch = new Map<number, Spot>();
  for (const sp of spots) if (!byPitch.has(sp.midi)) byPitch.set(sp.midi, sp);
  const pool = [...byPitch.values()].sort((a, b) => a.midi - b.midi).slice(0, o.difficulty === 'easy' ? 8 : 12);
  const rootIdx = Math.max(0, pool.findIndex((p) => (((p.midi - keyPc) % 12) + 12) % 12 === 0));

  const motif = pick(rhythms);
  const columns: WriterColumn[] = [];
  let idx = rootIdx;
  const step = () => {
    const r = rnd();
    const d = r < 0.35 ? 1 : r < 0.6 ? -1 : r < 0.75 ? 2 : r < 0.9 ? -2 : 0;
    idx = Math.max(0, Math.min(pool.length - 1, idx + d));
    return pool[idx]!;
  };
  // Call (bar 1) and response (bar 2) — repeated with a variation, the last bar resolving to the root.
  const phrases: Spot[][] = [];
  for (let bar = 0; bar < o.bars; bar++) {
    const onsets = bar === o.bars - 1 ? motif.filter((x) => x < 8) : bar === 2 ? motif : pick(rhythms);
    const notes: Spot[] = bar === 2 && phrases[0] ? phrases[0].slice(0, onsets.length) : onsets.map(() => step());
    while (notes.length < onsets.length) notes.push(step());
    if (bar === o.bars - 1) notes[notes.length - 1] = pool[rootIdx]!;
    phrases.push(notes);
    onsets.forEach((pos, k) => {
      const next = onsets[k + 1] ?? 16;
      const sp = notes[k]!;
      const n: WriterNote = { stringIdx: sp.stringIdx, fret: sp.fret };
      const isLast = bar === o.bars - 1 && k === onsets.length - 1;
      if (o.genre === 'metal' && sp === pool[rootIdx] && !isLast) n.palmMute = true;
      if (isLast) n.vibrato = true;
      columns.push({ notes: [n], units: next - pos });
    });
    // Leading rest inside a bar when the rhythm starts late.
    if (onsets[0]! > 0) columns.splice(columns.length - onsets.length, 0, { notes: [], units: onsets[0]! });
  }

  // Verifiable by ear: the same pitch twice in quick succession reads as one long note to the Sync
  // Report's pitch tracker (it hears the first attack only), so a short note never repeats its pitch.
  const unitMs = 60_000 / bpm / 4;
  const pitchOf = (n: WriterNote) => tuning[n.stringIdx]! + n.fret;
  for (let i = 1; i < columns.length; i++) {
    const prevCol = columns[i - 1]!;
    const a = prevCol.notes[0];
    const b = columns[i]!.notes[0];
    if (!a || !b || prevCol.notes.length > 1 || columns[i]!.notes.length > 1 || pitchOf(a) !== pitchOf(b) || prevCol.units * unitMs >= 300) continue;
    // Move whichever note is not the final resolution to a neighbouring scale note.
    const target = i === columns.length - 1 ? a : b;
    const at = pool.findIndex((p) => p.midi === pitchOf(target));
    const alt = pool[at + 1 < pool.length ? at + 1 : at - 1]!;
    target.stringIdx = alt.stringIdx;
    target.fret = alt.fret;
    target.palmMute = undefined;
  }
  // Palm-muted notes need some length to be heard (and checked) under distortion.
  for (const c of columns) if (c.notes[0]?.palmMute && c.units * unitMs < 180) c.notes[0].palmMute = undefined;

  // Techniques (medium/hard): hammer-ons/pull-offs within a string, a slide, a bend to a scale note.
  if (o.difficulty !== 'easy') {
    for (let i = 0; i + 1 < columns.length; i++) {
      const a = columns[i]!.notes[0];
      const b = columns[i + 1]!.notes[0];
      // No legato chains: a note reached by a hammer/slide has no attack of its own, so it doesn't start another.
      const prev = i > 0 ? columns[i - 1]!.notes[0] : undefined;
      if (!a || !b || a.palmMute || prev?.hammerToNext || prev?.slideToNext) continue;
      const d = b.fret - a.fret;
      if (a.stringIdx === b.stringIdx && d !== 0 && Math.abs(d) <= 3 && columns[i]!.units <= 2 && rnd() < 0.6) a.hammerToNext = true;
      // Slides need a fretted start and end (you can't slide off or onto an open string).
      else if (a.stringIdx === b.stringIdx && a.fret > 0 && b.fret > 0 && Math.abs(d) >= 2 && rnd() < 0.2) a.slideToNext = true;
    }
    if (o.difficulty === 'hard' || o.genre === 'blues') {
      const cand = columns.filter((c) => c.notes[0] && c.units >= 4 && c.notes[0].stringIdx <= 2 && !c.notes[0].hammerToNext && !c.notes[0].slideToNext && inScale(tuning[c.notes[0].stringIdx]! + c.notes[0].fret + 2));
      const target = cand.length ? pick(cand) : undefined;
      // Whole-step bend: the bent pitch is a scale note (checked above).
      if (target) target.notes[0]!.bendSemitones = 2;
    }
  }
  // Metal: power chord stabs (root + fifth) on accented quarter notes.
  if (o.genre === 'metal') {
    for (const c of columns) {
      const n = c.notes[0];
      if (n && n.stringIdx === tuning.length - 1 && !n.palmMute && !n.hammerToNext && !n.slideToNext && c.units >= 2 && n.fret + 2 <= 15) {
        const fifthString = tuning.length - 2;
        const fifthFret = tuning === DROP_D ? n.fret : n.fret + 2;
        c.notes.push({ stringIdx: fifthString, fret: fifthFret });
      }
    }
  }

  const keyName = NAMES[keyPc]!;
  const title = `${keyName} ${scaleName} ${o.genre} riff #${(o.seed % 997) + 1}`;
  const { text } = writeAlphaTex({ title, tempo: bpm, tuning, capo: 0, columns });
  return { title, alphaTex: text, bpm, key: keyName, scale: scaleName, tuning, genre: o.genre };
}
