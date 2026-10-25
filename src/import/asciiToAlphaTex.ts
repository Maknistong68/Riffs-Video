/** Parsed ASCII tab + rhythm (16ths per onset) → alphaTex via the shared writer. */
import { writeAlphaTex, type WriterColumn } from './alphatexWriter';
import type { ParsedAsciiTab } from './asciiTab';

export function asciiToAlphaTex(p: ParsedAsciiTab, opts: { title: string; bpm: number; units: number[] }) {
  const columns: WriterColumn[] = p.columns.map((c, i) => ({ notes: c.notes.map((n) => ({ ...n })), units: opts.units[i] ?? 2 }));
  return writeAlphaTex({ title: opts.title, tempo: opts.bpm, tuning: p.tuning, capo: p.capo, columns });
}
