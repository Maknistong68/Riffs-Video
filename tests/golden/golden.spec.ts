/**
 * npm run golden — for each golden riff, in real Chromium:
 *  1. timeline JSON must equal the stored snapshot,
 *  2. SHA-256 of drawFrame pixels for selected frames must equal stored hashes,
 *  3. a full on-device export must produce a green Sync Report.
 * UPDATE_GOLDEN=1 npm run golden rewrites the snapshots (review the diff!).
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstFrameAtOrAfter } from '../../src/engine/time';
import type { Timeline } from '../../src/engine/timeline';

const riffDir = join(import.meta.dirname, 'riffs');
const expectedDir = join(import.meta.dirname, 'expected');
const update = process.env.UPDATE_GOLDEN === '1';

type Harness = {
  frameHashes(text: string, frames: number[]): Promise<{ fontOk: boolean; timeline: Timeline; hashes: string[] }>;
  exportRiff(text: string, fps: 30 | 60): Promise<{ report: { ok: boolean; matched: number; total: number; maxAbsErrorMs: number } }>;
};

for (const file of readdirSync(riffDir).filter((f) => f.endsWith('.atex')).sort()) {
  test(file, async ({ page }) => {
    const text = readFileSync(join(riffDir, file), 'utf8');
    await page.goto('/golden.html');
    await page.waitForFunction(() => 'harness' in window);
    const call = <K extends keyof Harness>(k: K, ...args: Parameters<Harness[K]>) =>
      page.evaluate(([k, args]) => ((window as unknown as { harness: Record<string, (...a: unknown[]) => unknown> }).harness[k]!(...args)), [k, args] as const) as ReturnType<Harness[K]>;

    // Frames: start, each of the first 8 note onsets, and mid-note frames.
    const probe = await call('frameHashes', text, [0]);
    expect(probe.fontOk, 'bundled font must load for deterministic frames').toBe(true);
    const onsets = probe.timeline.events.slice(0, 8).map((e) => firstFrameAtOrAfter(e.startMs, 30));
    const frames = [...new Set([0, ...onsets, ...onsets.map((f) => f + 4)])].sort((a, b) => a - b);
    const { timeline, hashes } = await call('frameHashes', text, frames);
    const actual = { timeline, frames: Object.fromEntries(frames.map((f, i) => [f, hashes[i]])) };

    const path = join(expectedDir, file.replace('.atex', '.json'));
    if (update || !existsSync(path)) {
      mkdirSync(expectedDir, { recursive: true });
      writeFileSync(path, JSON.stringify(actual, null, 1) + '\n');
    }
    const expected = JSON.parse(readFileSync(path, 'utf8')) as typeof actual;
    expect(actual.timeline, 'timeline differs from snapshot').toEqual(expected.timeline);
    expect(actual.frames, 'drawFrame pixels differ from snapshot').toEqual(expected.frames);

    const { report } = await call('exportRiff', text, 30);
    console.log(`${file}: ${report.matched}/${report.total} matched, max error ${report.maxAbsErrorMs.toFixed(1)} ms`);
    expect(report.ok, 'Sync Report must be green').toBe(true);
  });
}
