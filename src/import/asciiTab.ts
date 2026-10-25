/**
 * Rule-based ASCII tab parser (phase 3). Pasted text → onsets (columns) with string/fret and
 * techniques, but no rhythm (P1): rhythm is guessed from spacing and refined by tap tempo.
 * Handles multi-line blocks, margin tunings, two-digit and right-aligned frets, chords,
 * h p / \ s b r ~ x <12>, PM lines, bar lines, "Capo N", "x2" repeats, several blocks.
 */

export type AsciiNote = {
  stringIdx: number;
  fret: number;
  dead?: boolean;
  hammerToNext?: boolean;
  slideToNext?: boolean;
  bendSemitones?: number;
  release?: boolean;
  vibrato?: boolean;
  palmMute?: boolean;
  harmonic?: boolean;
};

export type AsciiColumn = {
  notes: AsciiNote[];
  /** Characters until the next onset in the same block (spacing → rhythm guess). */
  gap: number;
  barBefore: boolean;
  block: number;
};

export type ParsedAsciiTab = {
  tuning: number[];
  tuningSource: 'labels' | 'text' | 'default';
  capo: number;
  columns: AsciiColumn[];
  blocks: number;
  warnings: string[];
};

export class AsciiTabError extends Error {}

const DEFAULT_TUNINGS: Record<number, number[]> = {
  4: [43, 38, 33, 28],
  5: [43, 38, 33, 28, 23],
  6: [64, 59, 55, 50, 45, 40],
  7: [64, 59, 55, 50, 45, 40, 35],
  8: [64, 59, 55, 50, 45, 40, 35, 30],
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const LABEL = /^\s*([A-Ga-g](?:#|b)?)\s*(?=[|:\-])/;
const BODY_CHARS = /^[-0-9|:hpbrsx~v/\\()<>*.^t ]*$/i;

type RawLine = { text: string; index: number };
type Block = { lines: RawLine[]; labels: (string | null)[]; bodyStart: number[]; pm: RawLine | null; repeat: number };

/** True when the text holds at least one block of text-tab lines (e.g. pasted into the alphaTex editor by mistake). */
export function looksLikeAsciiTab(text: string): boolean {
  let run = 0;
  for (const line of text.split(/\r?\n/)) {
    run = isTabLine(line) ? run + 1 : 0;
    if (run >= 4) return true;
  }
  return false;
}

/**
 * Words written after a tab line's last bar line ("   (play twice)", "  <- repeat") are notes
 * to the reader, not notes to play. Drop them; a repeat count in them becomes "x2" etc.
 */
export function stripTrailingNote(line: string): string {
  const bar = line.lastIndexOf('|');
  if (bar < 0) return line;
  const tail = line.slice(bar + 1);
  if (!/^\s+\S/.test(tail) || /-{3,}/.test(tail) || !/[a-z(<]/i.test(tail)) return line;
  if (/^\s*\(?\s*(?:[x×]\s*\d+|\d+\s*[x×])\s*\)?\s*$/i.test(tail)) return line; // "|  x2": the repeat parser reads it
  const times = /\btwice\b/i.test(tail) ? 2 : /\bthrice\b/i.test(tail) ? 3 : Number(/(?:[x×]\s*(\d+)|(\d+)\s*(?:[x×]|times))/i.exec(tail)?.slice(1).find(Boolean) ?? 0);
  return line.slice(0, bar + 1) + (times > 1 ? `x${times}` : '');
}

function isTabLine(line: string): boolean {
  const s = line.replace(/\s+[x×]\s*\d+\s*$|\s+\d+\s*[x×]\s*$/i, '');
  const m = LABEL.exec(s);
  const body = m ? s.slice(m[0].length) : s.trim();
  if ((body.match(/-/g) ?? []).length < 3) return false;
  return BODY_CHARS.test(body);
}

function pcOf(label: string): number {
  const base = PC[label[0]!.toUpperCase()]!;
  const acc = label[1] === '#' ? 1 : label[1] === 'b' ? -1 : 0;
  return (base + acc + 12) % 12;
}

/** Nearest MIDI pitch with pitch class `pc` to `near`. */
function nearestPc(pc: number, near: number): number {
  let best = near;
  let bestD = Infinity;
  for (let m = near - 12; m <= near + 12; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(m - near);
    if (d < bestD || (d === bestD && m < best)) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

function findBlocks(lines: RawLine[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTabLine(lines[i]!.text)) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isTabLine(lines[i]!.text)) i++;
    let group = lines.slice(start, i);
    // Very long runs are several blocks without blank lines: split by the label pattern repeating.
    while (group.length >= 4) {
      const size = group.length <= 8 ? group.length : guessBlockSize(group);
      blocks.push(makeBlock(group.slice(0, size), lines[start - 1] ?? null, lines[start + size] ?? null));
      group = group.slice(size);
    }
  }
  return blocks;
}

function guessBlockSize(group: RawLine[]): number {
  const labels = group.map((l) => LABEL.exec(l.text)?.[1] ?? null);
  for (const size of [6, 7, 4, 5, 8]) {
    if (labels[0] && labels[size] === labels[0]) return size;
  }
  return 6;
}

function makeBlock(lines: RawLine[], above: RawLine | null, below: RawLine | null): Block {
  const labels = lines.map((l) => LABEL.exec(l.text)?.[1] ?? null);
  const bodyStart = lines.map((l) => {
    const m = LABEL.exec(l.text);
    let k = m ? m[0].length : l.text.search(/\S/);
    if (l.text[k] === '|' || l.text[k] === ':') k++;
    return k;
  });
  const pm = above && /^\s*(p\.?\s*m\.?)[\s\-._|]*(\s+(p\.?\s*m\.?)[\s\-._|]*)*$/i.test(above.text) ? above : null;
  let repeat = 1;
  for (const l of [...lines, ...(below ? [below] : [])]) {
    const m = /\|\s*(?:\(?\s*[x×]\s*(\d+)\s*\)?|\(?(\d+)\s*[x×]\)?)\s*$/i.exec(l.text) ?? (l === below ? /^\s*\(?\s*(?:[x×]\s*(\d+)|(\d+)\s*[x×])\s*\)?\s*$/i.exec(l.text) : null);
    if (m) repeat = Math.max(repeat, Number(m[1] ?? m[2]));
  }
  return { lines, labels, bodyStart, pm, repeat: Math.min(repeat, 8) };
}

/** start/end: the note's own characters (used to group chords); tail: last modifier character. */
type Pending = { stringIdx: number; start: number; end: number; tail: number; note: AsciiNote };

/** Scan one string's body; returns notes with their character spans (relative to body start). */
function scanLine(body: string, stringIdx: number): { notes: Pending[]; bars: number[] } {
  const notes: Pending[] = [];
  const bars: number[] = [];
  const last = () => notes[notes.length - 1];
  let i = 0;
  const readNumber = (): string => {
    let s = '';
    while (i < body.length && /\d/.test(body[i]!) && s.length < 2) {
      if (s.length === 1 && Number(s + body[i]) > 24) break;
      s += body[i];
      i++;
    }
    return s;
  };
  while (i < body.length) {
    const c = body[i]!;
    const start = i;
    if (/\d/.test(c)) {
      const num = readNumber();
      notes.push({ stringIdx, start, end: i - 1, tail: i - 1, note: { stringIdx, fret: Number(num) } });
      // Bend / release are part of this note: 7b9, 7b(9), 7b9r7, 7b.
      if (body[i] === 'b') {
        i++;
        const paren = body[i] === '(';
        if (paren) i++;
        const target = readNumber();
        if (paren && body[i] === ')') i++;
        const n = last()!.note;
        n.bendSemitones = target ? Math.max(1, Number(target) - n.fret) : 2;
        if (body[i] === 'r') {
          i++;
          readNumber();
          n.release = true;
        }
        last()!.end = i - 1;
        last()!.tail = i - 1;
      }
      continue;
    }
    if (c === '<') {
      const close = body.indexOf('>', i);
      const num = close > i ? body.slice(i + 1, close) : '';
      if (/^\d{1,2}$/.test(num)) {
        notes.push({ stringIdx, start, end: close, tail: close, note: { stringIdx, fret: Number(num), harmonic: true } });
        i = close + 1;
        continue;
      }
    }
    if (c === '(') {
      const close = body.indexOf(')', i);
      const num = close > i ? body.slice(i + 1, close) : '';
      if (/^\d{1,2}$/.test(num)) {
        notes.push({ stringIdx, start, end: close, tail: close, note: { stringIdx, fret: Number(num) } }); // ghost note
        i = close + 1;
        continue;
      }
    }
    if (c === 'x' || c === 'X') {
      notes.push({ stringIdx, start, end: i, tail: i, note: { stringIdx, fret: 0, dead: true } });
      i++;
      continue;
    }
    const prev = last();
    if (prev && prev.tail >= i - 1 && 'hp/\\s~v'.includes(c)) {
      if (c === 'h' || c === 'p') prev.note.hammerToNext = true;
      else if (c === '/' || c === '\\' || c === 's') prev.note.slideToNext = true;
      else prev.note.vibrato = true;
      prev.tail = i; // modifiers chain (7~~~) without widening the note's own span
      i++;
      continue;
    }
    if (c === '|') bars.push(i);
    i++;
  }
  return { notes, bars };
}

function resolveTuning(block: Block, text: string): { tuning: number[]; source: ParsedAsciiTab['tuningSource'] } {
  const n = block.lines.length;
  const std = DEFAULT_TUNINGS[n] ?? DEFAULT_TUNINGS[6]!.slice(0, n);
  if (block.labels.every((l) => l !== null)) {
    return { tuning: block.labels.map((l, i) => nearestPc(pcOf(l!), std[i]!)), source: 'labels' };
  }
  if (n === 6) {
    if (/drop\s*d\b/i.test(text)) return { tuning: [64, 59, 55, 50, 45, 38], source: 'text' };
    if (/(half[\s-]*step\s*down|e\s*flat|\beb\s*(standard|tuning))/i.test(text)) return { tuning: [63, 58, 54, 49, 44, 39], source: 'text' };
  }
  return { tuning: std, source: 'default' };
}

export function parseAsciiTab(text: string): ParsedAsciiTab {
  const raw: RawLine[] = text.replace(/\t/g, '    ').split(/\r?\n/).map((t, index) => ({ text: stripTrailingNote(t.replace(/\s+$/, '')), index }));
  const blocks = findBlocks(raw);
  if (blocks.length === 0) throw new AsciiTabError('No tab found. Paste lines like  e|---0---3---|  (one line per string).');
  const warnings: string[] = [];
  const strings = blocks[0]!.lines.length;
  const usable = blocks.filter((b) => {
    if (b.lines.length !== strings) warnings.push(`Skipped a block with ${b.lines.length} lines (expected ${strings}).`);
    return b.lines.length === strings;
  });
  const { tuning, source } = resolveTuning(usable[0]!, text);
  const capo = Number(/\bcapo\s*(?:on\s*|at\s*|fret\s*)?(\d{1,2})/i.exec(text)?.[1] ?? 0);
  // Lines are listed high → low unless the labels clearly say otherwise (low string first).
  const reversed = source === 'labels' && tuning[0]! < tuning[tuning.length - 1]!;
  const columns: AsciiColumn[] = [];

  usable.forEach((block, bi) => {
    const lines = reversed ? [...block.lines].reverse() : block.lines;
    const starts = reversed ? [...block.bodyStart].reverse() : block.bodyStart;
    const pending: Pending[] = [];
    let bars: number[] = [];
    let bodyLen = 0;
    lines.forEach((l, s) => {
      const body = l.text.slice(starts[s]!).replace(/\|\s*(\(?\s*[x×]\s*\d+\s*\)?|\(?\d+\s*[x×]\)?)\s*$/i, '|');
      bodyLen = Math.max(bodyLen, body.length);
      const r = scanLine(body, s);
      pending.push(...r.notes);
      if (s === 0) bars = r.bars;
    });
    // Palm-mute ranges from the PM line above, mapped to body columns.
    const pmRanges: [number, number][] = [];
    if (block.pm) {
      const offset = Math.round(starts.reduce((a, b) => a + b, 0) / starts.length);
      for (const m of block.pm.text.matchAll(/p\.?\s*m\.?[\s\-._|]*/gi)) {
        const from = m.index! - offset;
        const to = m.index! + m[0].replace(/\s+$/, '').length - 1 - offset;
        pmRanges.push([from, to]);
      }
    }
    // Group notes into onsets: overlapping character spans across strings strike together.
    pending.sort((a, b) => a.start - b.start || a.stringIdx - b.stringIdx);
    const groups: { start: number; end: number; notes: Pending[] }[] = [];
    for (const p of pending) {
      const g = groups[groups.length - 1];
      if (g && p.start <= g.end && !g.notes.some((q) => q.stringIdx === p.stringIdx)) {
        g.notes.push(p);
        g.end = Math.max(g.end, p.end);
      } else groups.push({ start: p.start, end: p.end, notes: [p] });
    }
    const blockCols: AsciiColumn[] = groups.map((g, k) => {
      const next = groups[k + 1];
      const prevStart = k > 0 ? groups[k - 1]!.start : -1;
      const notes = g.notes.map((p) => ({ ...p.note })).sort((a, b) => a.stringIdx - b.stringIdx);
      if (pmRanges.some(([a, b]) => g.start >= a && g.start <= b)) for (const n of notes) n.palmMute = true;
      return {
        notes,
        gap: next ? next.start - g.start : Math.max(1, bodyLen - g.start),
        barBefore: bars.some((x) => x > prevStart && x < g.start),
        block: bi,
      };
    });
    // Trailing space after the last note is often arbitrary: cap it at the block's typical gap.
    const gaps = blockCols.slice(0, -1).map((c) => c.gap).sort((a, b) => a - b);
    const typical = gaps[(gaps.length - 1) >> 1] ?? 2; // lower median: lean towards the shorter spacing
    const lastCol = blockCols[blockCols.length - 1];
    if (lastCol) lastCol.gap = Math.min(lastCol.gap, typical * 2);
    for (let r = 0; r < block.repeat; r++) columns.push(...blockCols.map((c) => ({ ...c, notes: c.notes.map((n) => ({ ...n })) })));
  });

  if (columns.length === 0) throw new AsciiTabError('Found tab lines but no notes in them.');
  return { tuning, tuningSource: source, capo, columns, blocks: usable.length, warnings };
}

/** Rhythm guess from spacing (P1): typical gap = an eighth note. */
export function spacingRhythm(columns: readonly AsciiColumn[]): number[] {
  // The gap after a block's last note is trailing dashes, not rhythm: leave it out of "typical".
  const inner = columns.filter((c, i) => columns[i + 1]?.block === c.block);
  const gaps = (inner.length ? inner : columns).map((c) => c.gap).sort((a, b) => a - b);
  const typical = Math.max(1, gaps[(gaps.length - 1) >> 1] ?? 2);
  return columns.map((c) => Math.max(1, Math.min(8, Math.round((2 * c.gap) / typical))));
}
