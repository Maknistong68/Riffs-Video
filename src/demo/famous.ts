/**
 * Famous riffs — 20 well-known melodies that are in the public domain (classical pieces and
 * traditional tunes), so the videos are safe to post and monetize with the synth sound.
 * Copyrighted songs are deliberately not included: the app never ships them (CLAUDE.md §4).
 *
 * Each riff is written in alphaTex with notes as pitch names on a chosen string ("E5/1" = E5 on
 * string 1, the high e). `famousAlphaTex()` turns them into fret.string from the tuning, so a
 * fret can never disagree with the pitch it is meant to be (unit-tested against the names).
 */
import type { DrumPattern } from '../audio/drums';
import type { ThemeId } from '../render/theme';

export type FamousLook = { theme: ThemeId; tone: string; drums: DrumPattern };

export type FamousRiff = {
  id: string;
  title: string;
  /** Composer or origin, as shown in the library and the video credit. */
  composer: string;
  /** Why people know it (shown under the title in the picker). */
  hint: string;
  level: 'easy' | 'medium' | 'hard';
  look: FamousLook;
  tempo: number;
  /** High string first, alphaTex note names. Default: standard tuning. */
  tuning?: string[];
  /** alphaTex body with pitch-name notes. */
  body: string;
};

const STANDARD = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
const DROP_D = ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'];

const CLASSICAL: FamousLook = { theme: 'dark', tone: 'nylon', drums: 'none' };
const ACOUSTIC: FamousLook = { theme: 'acoustic', tone: 'acoustic', drums: 'none' };
const METAL: FamousLook = { theme: 'metal', tone: 'metal', drums: 'metal' };
const ROCK: FamousLook = { theme: 'dark', tone: 'rock', drums: 'rock' };
const LEAD: FamousLook = { theme: 'dark', tone: 'lead', drums: 'none' };

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" → 61 (C4 = 60). */
export function noteMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Not a note name: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1]!]! + acc;
}

/** Spanish Romance style bar: per beat a triplet of melody note + two inner strings; bass on beat 1. */
function arpTriplets(melody: string[], inner: [string, string], bass: string): string {
  return melody
    .map((m, i) => `${i === 0 ? `(${m} ${bass})` : m} {tu 3} ${inner[0]} {tu 3} ${inner[1]} {tu 3}`)
    .join(' ');
}

/** Moonlight Sonata style beat: three triplet eighths, the bass struck with the first. */
function tripletBeat(notes: [string, string, string], bass?: string): string {
  const [a, b, c] = notes;
  return `${bass ? `(${a} ${bass})` : a} {tu 3} ${b} {tu 3} ${c} {tu 3}`;
}

/** Six-eighth broken chord: bass, then strings 3 2 1 2 3. */
function broken(bass: string, s3: string, s2: string, s1: string): string {
  return `${bass} ${s3} ${s2} ${s1} ${s2} ${s3}`;
}

export const FAMOUS_RIFFS: FamousRiff[] = [
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven (1810)',
    hint: 'The most famous piano opening, on guitar',
    level: 'medium',
    look: CLASSICAL,
    tempo: 66,
    body: `\\ts 1 8 :16 E5/1 D#5/1 |
      \\ts 3 8 E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1 | :8 A4/1 :16 r C4/2 E4/1 A4/1 | :8 B4/1 :16 r E4/1 G#4/1 B4/1 |
      :8 C5/1 :16 r E4/1 E5/1 D#5/1 | E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1 | :8 A4/1 :16 r C4/2 E4/1 A4/1 |
      :8 B4/1 :16 r E4/1 C5/1 B4/1 | :4 A4/1 {d}`,
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven (1824)',
    hint: 'Symphony No. 9 — the first melody most people learn',
    level: 'easy',
    look: ACOUSTIC,
    tempo: 112,
    body: `:4 F#4/1 F#4/1 G4/1 A4/1 | A4/1 G4/1 F#4/1 E4/1 | D4/2 D4/2 E4/1 F#4/1 | F#4/1 {d} :8 E4/1 :2 E4/1 |
      :4 F#4/1 F#4/1 G4/1 A4/1 | A4/1 G4/1 F#4/1 E4/1 | D4/2 D4/2 E4/1 F#4/1 | E4/1 {d} :8 D4/2 :2 D4/2`,
  },
  {
    id: 'mountain-king',
    title: 'In the Hall of the Mountain King',
    composer: 'Edvard Grieg (1875)',
    hint: 'Peer Gynt — the classic metal cover',
    level: 'medium',
    look: METAL,
    tempo: 140,
    body: `:8 B2/5 C#3/5 D3/5 E3/4 F#3/4 D3/5 :4 F#3/4 | :8 F3/4 C#3/5 :4 F3/4 :8 E3/4 C3/5 :4 E3/4 |
      :8 B2/5 C#3/5 D3/5 E3/4 F#3/4 D3/5 F#3/4 B3/3 | A3/3 F#3/4 D3/5 F#3/4 :2 A3/3`,
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English (16th century)',
    hint: 'The Tudor ballad everyone recognises',
    level: 'medium',
    look: CLASSICAL,
    tempo: 100,
    body: `\\ts 1 4 :4 A4/2 |
      \\ts 3 4 :2 C5/1 :4 D5/1 | E5/1 {d} :8 F5/1 :4 E5/1 | :2 D5/1 :4 B4/1 | G4/2 {d} :8 A4/2 :4 B4/1 |
      :2 C5/1 :4 A4/2 | A4/2 {d} :8 G#4/2 :4 A4/2 | :2 B4/1 :4 G#4/2 | :2 E4/2 :4 A4/2 |
      :2 C5/1 :4 D5/1 | E5/1 {d} :8 F5/1 :4 E5/1 | :2 D5/1 :4 B4/1 | G4/2 {d} :8 A4/2 :4 B4/1 |
      C5/1 {d} :8 B4/1 :4 A4/2 | G#4/2 {d} :8 F#4/2 :4 G#4/2 | :2 A4/2 {d}`,
  },
  {
    id: 'spanish-romance',
    title: 'Spanish Romance',
    composer: 'Anonymous (19th century)',
    hint: 'Romance anónimo — the classical guitar showpiece',
    level: 'medium',
    look: CLASSICAL,
    tempo: 76,
    body: `\\ts 3 4 :8 ${arpTriplets(['B4/1', 'B4/1', 'B4/1'], ['B3/2', 'G3/3'], 'E2/6')} |
      ${arpTriplets(['B4/1', 'A4/1', 'G4/1'], ['B3/2', 'G3/3'], 'E2/6')} |
      ${arpTriplets(['G4/1', 'F#4/1', 'E4/1'], ['B3/2', 'G3/3'], 'E2/6')} |
      ${arpTriplets(['E4/1', 'G4/1', 'B4/1'], ['B3/2', 'G3/3'], 'E2/6')} |
      ${arpTriplets(['E5/1', 'E5/1', 'E5/1'], ['B4/2', 'G4/3'], 'E2/6')} |
      ${arpTriplets(['E5/1', 'D5/1', 'C5/1'], ['B4/2', 'G4/3'], 'E2/6')}`,
  },
  {
    id: 'moonlight-sonata',
    title: 'Moonlight Sonata',
    composer: 'Ludwig van Beethoven (1801)',
    hint: 'The haunting triplets of the first movement',
    level: 'medium',
    look: CLASSICAL,
    tempo: 56,
    body: `:8 ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'], 'C#3/5')} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} |
      ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'], 'B2/5')} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} |
      ${tripletBeat(['A3/3', 'C#4/2', 'E4/1'], 'A2/5')} ${tripletBeat(['A3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['A3/3', 'D4/2', 'F#4/1'], 'F#2/6')} ${tripletBeat(['A3/3', 'D4/2', 'F#4/1'])} |
      ${tripletBeat(['G#3/3', 'C4/2', 'F#4/1'], 'G#2/6')} ${tripletBeat(['G#3/3', 'C#4/2', 'E4/1'])} ${tripletBeat(['G#3/4', 'C#4/3', 'D#4/2'])} ${tripletBeat(['F#3/4', 'C4/3', 'D#4/2'])}`,
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel (c. 1680)',
    hint: 'The wedding classic over its famous bass line',
    level: 'easy',
    look: CLASSICAL,
    tempo: 60,
    tuning: DROP_D,
    body: `:4 (F#5/1 D3/4) (E5/1 A2/5) (D5/1 B2/5) (C#5/1 F#2/6) | (B4/1 G2/6) (A4/1 D2/6) (B4/1 G2/6) (C#5/1 A2/5) |
      (D5/1 D3/4) (C#5/1 A2/5) (B4/1 B2/5) (A4/1 F#2/6) | (G4/1 G2/6) (F#4/1 D2/6) (G4/1 G2/6) (E4/1 A2/5)`,
  },
  {
    id: 'korobeiniki',
    title: 'Korobeiniki (Tetris theme)',
    composer: 'Russian folk song (1861)',
    hint: 'The Tetris music — instantly recognised',
    level: 'medium',
    look: ROCK,
    tempo: 150,
    body: `:4 E4/2 :8 B3/3 C4/3 :4 D4/3 :8 C4/3 B3/3 | :4 A3/4 :8 A3/4 C4/3 :4 E4/2 :8 D4/3 C4/3 |
      :4 B3/3 {d} :8 C4/3 :4 D4/3 E4/2 | C4/3 A3/4 :2 A3/4 |
      :4 D4/3 {d} :8 F4/2 :4 A4/1 :8 G4/2 F4/2 | :4 E4/2 {d} :8 C4/3 :4 E4/2 :8 D4/3 C4/3 |
      :4 B3/3 :8 B3/3 C4/3 :4 D4/3 E4/2 | C4/3 A3/4 :2 A3/4`,
  },
  {
    id: 'rising-sun',
    title: 'House of the Rising Sun',
    composer: 'Traditional American folk',
    hint: 'The arpeggio every guitarist learns first',
    level: 'easy',
    look: ACOUSTIC,
    tempo: 105,
    body: `\\ts 6 8 :8 ${broken('A2/5', 'A3/3', 'C4/2', 'E4/1')} | ${broken('C3/5', 'G3/3', 'C4/2', 'E4/1')} |
      ${broken('D3/4', 'A3/3', 'D4/2', 'F#4/1')} | ${broken('F2/6', 'A3/3', 'C4/2', 'F4/1')} |
      ${broken('A2/5', 'A3/3', 'C4/2', 'E4/1')} | ${broken('C3/5', 'G3/3', 'C4/2', 'E4/1')} |
      ${broken('E2/6', 'G#3/3', 'B3/2', 'E4/1')} | ${broken('E2/6', 'G#3/3', 'B3/2', 'E4/1')}`,
  },
  {
    id: 'bourree',
    title: 'Bourrée in E minor',
    composer: 'Johann Sebastian Bach (c. 1710)',
    hint: 'Lute Suite BWV 996 — the Jethro Tull favourite',
    level: 'medium',
    look: CLASSICAL,
    tempo: 100,
    body: `\\ts 1 4 :8 E4/1 F#4/1 |
      \\ts 4 4 :4 G4/1 :8 F#4/1 E4/1 :4 D#4/2 :8 E4/1 F#4/1 | :4 B3/2 :8 C#4/2 D#4/2 :4 E4/1 :8 D4/2 C4/2 |
      :4 B3/2 :8 A3/3 G3/3 :4 F#3/4 :8 G3/3 A3/3 | :8 B3/2 A3/3 G3/3 F#3/4 :2 E3/4`,
  },
  {
    id: 'toccata',
    title: 'Toccata and Fugue in D minor',
    composer: 'Johann Sebastian Bach (c. 1704)',
    hint: 'The spooky organ opening',
    level: 'medium',
    look: METAL,
    tempo: 60,
    body: `:16 A4/1 G4/1 :4 A4/1 {d} :16 G4/1 F4/1 E4/1 D4/2 :4 C#4/2 | :2 D4/2 r |
      :16 A3/3 G3/3 :4 A3/3 {d} :16 E3/4 F3/4 :4 C#3/5 {d} | :2 D3/4 r`,
  },
  {
    id: 'rondo-alla-turca',
    title: 'Rondo alla Turca',
    composer: 'Wolfgang Amadeus Mozart (1783)',
    hint: 'Turkish March — fast and fun',
    level: 'hard',
    look: CLASSICAL,
    tempo: 116,
    body: `\\ts 1 4 :16 B3/3 A3/4 G#3/4 A3/4 |
      \\ts 2 4 :8 C4/3 r :16 D4/3 C4/3 B3/3 C4/3 | :8 E4/2 r :16 F4/2 E4/2 D#4/2 E4/2 |
      B4/1 A4/1 G#4/1 A4/1 B4/1 A4/1 G#4/1 A4/1 | :4 C5/1 :8 A4/1 C5/1 |
      B4/1 A4/1 G4/2 A4/1 | B4/1 A4/1 G4/2 A4/1 | B4/1 A4/1 G4/2 F#4/2 | :4 E4/2 r`,
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional hymn (1779)',
    hint: 'Slow, simple and beautiful',
    level: 'easy',
    look: ACOUSTIC,
    tempo: 80,
    body: `\\ts 1 4 :4 D4/3 |
      \\ts 3 4 :2 G4/2 :8 B4/1 G4/2 | :2 B4/1 :4 A4/1 | :2 G4/2 :4 E4/2 | :2 D4/3 :4 D4/3 |
      :2 G4/2 :8 B4/1 G4/2 | :2 B4/1 :4 A4/1 | :2 D5/1 {d}`,
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont (1857)',
    hint: 'The Christmas riff',
    level: 'easy',
    look: ROCK,
    tempo: 120,
    body: `:4 B4/1 B4/1 :2 B4/1 | :4 B4/1 B4/1 :2 B4/1 | :4 B4/1 D5/1 G4/2 {d} :8 A4/2 | :1 B4/1 |
      :4 C5/1 C5/1 C5/1 {d} :8 C5/1 | :4 C5/1 B4/1 B4/1 :8 B4/1 B4/1 | :4 B4/1 A4/2 A4/2 B4/1 | :2 A4/2 D5/1`,
  },
  {
    id: 'carol-of-the-bells',
    title: 'Carol of the Bells',
    composer: 'Mykola Leontovych (1914)',
    hint: 'Shchedryk — the four-note ostinato',
    level: 'easy',
    look: METAL,
    tempo: 180,
    body: `\\ts 3 4 ${Array.from({ length: 8 }, () => ':4 Bb4/1 :8 A4/1 Bb4/1 :4 G4/1').join(' | ')}`,
  },
  {
    id: 'when-the-saints',
    title: 'When the Saints Go Marching In',
    composer: 'Traditional spiritual',
    hint: 'The New Orleans classic',
    level: 'easy',
    look: ROCK,
    tempo: 120,
    body: `\\ts 3 4 :4 C4/3 E4/2 F4/2 |
      \\ts 4 4 :1 G4/2 | :4 r C4/3 E4/2 F4/2 | :1 G4/2 | :4 r C4/3 E4/2 F4/2 |
      :2 G4/2 E4/2 | C4/3 E4/2 | :1 D4/3`,
  },
  {
    id: 'funeral-march',
    title: 'Funeral March',
    composer: 'Frédéric Chopin (1839)',
    hint: 'Dun dun da-dun — the darkest four bars',
    level: 'easy',
    look: METAL,
    tempo: 54,
    body: `:4 Bb2/5 :8 Bb2/5 {d} :16 Bb2/5 :2 Bb2/5 | :8 Db3/5 {d} :16 C3/5 :8 C3/5 {d} :16 Bb2/5 :8 Bb2/5 {d} :16 A2/5 :4 Bb2/5 |
      :4 Bb2/5 :8 Bb2/5 {d} :16 Bb2/5 :2 Bb2/5 | :8 Db3/5 {d} :16 C3/5 :8 C3/5 {d} :16 Bb2/5 :8 Bb2/5 {d} :16 A2/5 :4 Bb2/5`,
  },
  {
    id: 'bumblebee',
    title: 'Flight of the Bumblebee',
    composer: 'Nikolai Rimsky-Korsakov (1900)',
    hint: 'The shred showcase',
    level: 'hard',
    look: LEAD,
    tempo: 140,
    body: `:16 E5/1 D#5/1 D5/1 C#5/1 D5/1 C#5/1 C5/1 B4/1 C5/1 B4/1 A#4/1 A4/1 G#4/2 G4/2 F#4/2 F4/2 |
      E4/2 D#4/2 D4/2 C#4/2 C4/2 F4/2 E4/2 D#4/2 E4/2 D#4/2 D4/2 C#4/2 C4/2 C#4/2 D4/2 D#4/2 | :4 E4/2 r :2 r`,
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Christian Petzold (c. 1725)',
    hint: 'From the Anna Magdalena Bach notebook',
    level: 'medium',
    look: CLASSICAL,
    tempo: 110,
    body: `\\ts 3 4 :4 D5/1 :8 G4/2 A4/2 B4/1 C5/1 | :4 D5/1 G4/2 G4/2 | :4 E5/1 :8 C5/1 D5/1 E5/1 F#5/1 | :4 G5/1 G4/2 G4/2 |
      :4 C5/1 :8 D5/1 C5/1 B4/1 A4/2 | :4 B4/1 :8 C5/1 B4/1 A4/2 G4/2 | :4 F#4/2 :8 G4/2 A4/2 B4/1 G4/2 | :2 A4/2 {d}`,
  },
  {
    id: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Mildred & Patty Hill (1893)',
    hint: 'Play it for someone’s birthday',
    level: 'easy',
    look: ACOUSTIC,
    tempo: 100,
    body: `\\ts 1 4 :8 G4/2 {d} :16 G4/2 |
      \\ts 3 4 :4 A4/2 G4/2 C5/1 | :2 B4/1 :8 G4/2 {d} :16 G4/2 | :4 A4/2 G4/2 D5/1 | :2 C5/1 :8 G4/2 {d} :16 G4/2 |
      :4 G5/1 E5/1 C5/1 | :4 B4/1 A4/2 :8 F5/1 {d} :16 F5/1 | :4 E5/1 C5/1 D5/1 | :2 C5/1 {d}`,
  },
];

const NOTE_TOKEN = /([A-G][#b]?-?\d)\/(\d)/g;

/** The riff as alphaTex: header + body with pitch names turned into fret.string. */
export function famousAlphaTex(r: FamousRiff): string {
  const tuning = r.tuning ?? STANDARD;
  const open = tuning.map(noteMidi);
  const body = r.body.replace(NOTE_TOKEN, (_all, name: string, s: string) => {
    const string = Number(s);
    const base = open[string - 1];
    if (base === undefined) throw new Error(`${r.id}: no string ${string}`);
    const fret = noteMidi(name) - base;
    if (fret < 0 || fret > 22) throw new Error(`${r.id}: ${name} can't be played on string ${string}`);
    return `${fret}.${string}`;
  });
  return [
    `\\title "${r.title}"`,
    `\\artist "${r.composer}"`,
    `\\tempo ${r.tempo}`,
    '\\track "Guitar"',
    '\\staff {tabs}',
    `\\tuning (${tuning.join(' ')})`,
    body.replace(/\n\s+/g, '\n'),
  ].join('\n');
}

/** The pitch names of the riff in playing order (chord notes as written). For tests. */
export function famousNoteNames(r: FamousRiff): string[] {
  return [...r.body.matchAll(NOTE_TOKEN)].map((m) => m[1]!);
}
