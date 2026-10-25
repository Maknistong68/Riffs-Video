/**
 * "Part 1 / Part 2" videos (phase 6): split a riff into copies that each play a range of bars and
 * end with a "Part i of N" card, then queue them for export.
 */
import { db, styleOf, type RiffRecord } from '../storage/db';
import { duplicateRiff, updateRiff } from '../storage/riffs';
import { enqueue } from './queue';

/** Bar ranges of `barsPerPart` bars covering bars 0..barCount-1 (last part takes the remainder). */
export function partRanges(barCount: number, barsPerPart: number): { fromBar: number; toBar: number }[] {
  const per = Math.max(1, Math.floor(barsPerPart));
  const out: { fromBar: number; toBar: number }[] = [];
  for (let from = 0; from < barCount; from += per) out.push({ fromBar: from, toBar: Math.min(barCount, from + per) - 1 });
  // A one-bar leftover joins the previous part rather than becoming a tiny video.
  if (out.length > 1 && out[out.length - 1]!.toBar === out[out.length - 1]!.fromBar && per > 1) {
    const last = out.pop()!;
    out[out.length - 1]!.toBar = last.toBar;
  }
  return out;
}

export function barCount(riff: RiffRecord): number {
  const t = riff.timelineCache;
  return t ? t.bars.reduce((m, b) => Math.max(m, b.index), -1) + 1 : 0;
}

/** Creates the part riffs, queues them, returns their ids. */
export async function splitIntoParts(riff: RiffRecord, barsPerPart: number): Promise<string[]> {
  const ranges = partRanges(barCount(riff), barsPerPart);
  if (ranges.length < 2) return [];
  const base = styleOf(riff);
  const ids: string[] = [];
  for (const [k, range] of ranges.entries()) {
    const id = await duplicateRiff(riff.id);
    if (!id) continue;
    await updateRiff(id, {
      title: `${riff.title} (Part ${k + 1}/${ranges.length})`,
      reviewed: riff.reviewed || !!riff.demoId,
      timelineCache: undefined,
      styleSettings: {
        ...base,
        teach: { ...base.teach, range },
        render: { ...base.render, endCard: { kind: 'part', text: '', part: k + 1, parts: ranges.length } },
      },
    });
    ids.push(id);
  }
  const parts = (await db().riffs.bulkGet(ids)).filter((r): r is RiffRecord => !!r);
  await enqueue(parts);
  return ids;
}
