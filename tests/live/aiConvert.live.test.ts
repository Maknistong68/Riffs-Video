/**
 * Live AI-import eval (costs API credits — opt-in):
 *   CONVERT_TAB_URL=https://<project>.supabase.co/functions/v1/convert-tab SUPABASE_ANON_KEY=... npm run ai:eval
 * Sends the 10 Phase 3 ASCII fixtures through the deployed Edge Function, re-checks every answer
 * exactly like the app does (alphaTab parse + timeline validation), and scores the notes against
 * the hand-written expected lists. Skipped when the env vars are missing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { convertTabWithAI } from '../../src/import/ai';
import { checkAiTab } from '../../src/import/aiRiff';
import { loadAlphaTex } from '../../src/import/alphatab';

const url = process.env.CONVERT_TAB_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const dir = join(import.meta.dirname, '../fixtures/ascii');
type Expected = { tuning: number[]; columns: (number | string)[][][] };
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Record<string, Expected>;
const files = Object.keys(expected).filter((k) => k.endsWith('.txt'));

/** Best alignment of two column sequences, maximising matched (string, fret) notes. */
function matchedNotes(a: string[][], b: string[][]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const common = a[i - 1]!.filter((n) => b[j - 1]!.includes(n)).length;
      dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]! + common);
    }
  }
  return dp[a.length]![b.length]!;
}

describe.skipIf(!url || !anonKey)('AI import against the 10 hand-checked ASCII tabs (live)', () => {
  const scores: number[] = [];
  for (const f of files) {
    it(f, async () => {
      const text = readFileSync(join(dir, f), 'utf8');
      const r = await convertTabWithAI({ text }, { config: { url: url!, anonKey: anonKey! }, deviceId: 'live-eval-0001', timeoutMs: 300_000 });
      if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
      const check = checkAiTab(r.alphaTex, r.notes);
      expect(check.errors, 'the app must be able to read the AI tab').toEqual([]);
      const t = buildTimeline(loadAlphaTex(r.alphaTex), { ...DEFAULT_BUILD, trackIndex: check.trackIndex }).timeline;
      const got: string[][] = [];
      let last = -1;
      for (const e of t.events) {
        if (e.legato && e.tech.includes('tieContinue')) continue;
        if (e.startMs !== last) got.push([]);
        last = e.startMs;
        got[got.length - 1]!.push(`${e.stringIdx}:${e.tech.includes('dead') ? 'x' : e.fret}`);
      }
      const want = expected[f]!.columns.map((col) => col.map((n) => `${n[0]}:${String(n[2] ?? '').includes('x') ? 'x' : n[1]}`));
      const m = matchedNotes(want, got);
      const nWant = want.flat().length;
      const nGot = got.flat().length;
      const f1 = (2 * m) / (nWant + nGot);
      scores.push(f1);
      console.log(`${f}: F1 ${f1.toFixed(3)} (${m} matched, expected ${nWant}, got ${nGot}); tuning ${t.tuning.join() === expected[f]!.tuning.join() ? 'ok' : 'DIFFERENT'}; amber ${Object.values(check.noteConfidence).filter((c) => c < 0.7).length}`);
    });
  }
  it('mean note accuracy ≥ 90 %', () => {
    const mean = scores.reduce((s, x) => s + x, 0) / Math.max(1, scores.length);
    console.log(`mean F1 ${mean.toFixed(3)} over ${scores.length} tabs`);
    expect(scores.length).toBe(files.length);
    expect(mean).toBeGreaterThanOrEqual(0.9);
  });
});
