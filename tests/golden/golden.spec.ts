/**
 * npm run golden — for each golden riff, in real Chromium:
 *  1. timeline JSON must equal the stored snapshot,
 *  2. SHA-256 of drawFrame pixels (default Classic style AND a per-riff preset/skin/teach
 *     variant) must equal stored hashes,
 *  3. a full on-device export of the variant (incl. slow-mo / loop passes) must produce a
 *     green Sync Report.
 * UPDATE_GOLDEN=1 npm run golden rewrites the snapshots (review the diff!).
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeachOptions } from '../../src/engine/arrange';
import { firstFrameAtOrAfter } from '../../src/engine/time';
import type { Timeline } from '../../src/engine/timeline';
import type { RenderStyle } from '../../src/render/style';

const riffDir = join(import.meta.dirname, 'riffs');
const expectedDir = join(import.meta.dirname, 'expected');
const update = process.env.UPDATE_GOLDEN === '1';
// 3D variants render in software WebGL on CI machines: the long slow-mo + loop export needs time.
test.setTimeout(1_800_000);

type Variant = { style: Partial<RenderStyle>; teach: TeachOptions; fps: 30 | 60; tone: string };
const NONE: TeachOptions = { slowMo: false, loopHardest: false };
// Every layout, most skins, left-handed and every teach option are covered across the five riffs.
const VARIANTS: Record<string, Variant> = {
  '01-pentatonic-run.atex': { style: { view: '2d', layout: 'overlay', skin: 'lespaul', fingerNumbers: true }, teach: { slowMo: true, loopHardest: false }, fps: 30, tone: 'lead' },
  '02-chords.atex': { style: { view: '3d', camera: { yaw: -26, pitch: 24, motion: 'static' }, layout: 'split', skin: 'acoustic', noteNames: true }, teach: NONE, fps: 60, tone: 'acoustic' },
  '03-repeats.atex': { style: { view: '3d', camera: { yaw: -40, pitch: 18, motion: 'orbit' }, layout: 'closeup', skin: 'strat' }, teach: { slowMo: true, loopHardest: true }, fps: 30, tone: 'rock' },
  '04-tempo-ties.atex': { style: { view: '2d', layout: 'classic', skin: 'classical', leftHanded: true }, teach: { slowMo: false, loopHardest: true }, fps: 60, tone: 'nylon' },
  '05-techniques.atex': { style: { view: '3d', camera: { yaw: -14, pitch: 60, motion: 'static' }, layout: 'classic', skin: 'seven', difficulty: 'Medium', credit: 'Golden riff', fingerNumbers: true }, teach: { slowMo: true, loopHardest: true }, fps: 30, tone: 'metal' },
};

type HashResult = { fontOk: boolean; timeline: Timeline; hashes: string[] };
type Harness = {
  frameHashes(text: string, frames: number[], style?: Partial<RenderStyle>, teach?: TeachOptions): Promise<HashResult>;
  exportRiff(text: string, fps: 30 | 60, style?: Partial<RenderStyle>, teach?: TeachOptions, tone?: string): Promise<{ report: { ok: boolean; matched: number; total: number; maxAbsErrorMs: number; matches: { ok: boolean; detail: string }[] } }>;
};

/** Start, the first 8 note onsets, a few frames into each, and one frame per teach section. */
function pickFrames(t: Timeline): number[] {
  const onsets = t.events.slice(0, 8).map((e) => firstFrameAtOrAfter(e.startMs, 30));
  const sections = (t.sections ?? []).map((s) => firstFrameAtOrAfter(s.startMs + 600, 30));
  return [...new Set([0, ...onsets, ...onsets.map((f) => f + 4), ...sections])].sort((a, b) => a - b);
}

for (const file of readdirSync(riffDir).filter((f) => f.endsWith('.atex')).sort()) {
  test(file, async ({ page }) => {
    const text = readFileSync(join(riffDir, file), 'utf8');
    const variant = VARIANTS[file]!;
    await page.goto('/golden.html');
    await page.waitForFunction(() => 'harness' in window);
    const call = <K extends keyof Harness>(k: K, ...args: Parameters<Harness[K]>) =>
      page.evaluate(([k, args]) => ((window as unknown as { harness: Record<string, (...a: unknown[]) => unknown> }).harness[k]!(...args)), [k, args] as const) as ReturnType<Harness[K]>;

    const FLAT: Partial<RenderStyle> = { view: '2d' };
    const probe = await call('frameHashes', text, [0], FLAT);
    expect(probe.fontOk, 'bundled fonts must load for deterministic frames').toBe(true);
    const frames = pickFrames(probe.timeline);
    const plain = await call('frameHashes', text, frames, FLAT);
    const vProbe = await call('frameHashes', text, [0], variant.style, variant.teach);
    const vFrames = pickFrames(vProbe.timeline);
    const styled = await call('frameHashes', text, vFrames, variant.style, variant.teach);
    const actual = {
      timeline: plain.timeline,
      frames: Object.fromEntries(frames.map((f, i) => [f, plain.hashes[i]])),
      variant: { ...variant, sections: styled.timeline.sections ?? [], frames: Object.fromEntries(vFrames.map((f, i) => [f, styled.hashes[i]])) },
    };

    const path = join(expectedDir, file.replace('.atex', '.json'));
    if (update || !existsSync(path)) {
      mkdirSync(expectedDir, { recursive: true });
      writeFileSync(path, JSON.stringify(actual, null, 1) + '\n');
    }
    const expected = JSON.parse(readFileSync(path, 'utf8')) as typeof actual;
    expect(actual.timeline, 'timeline differs from snapshot').toEqual(expected.timeline);
    expect(actual.frames, 'drawFrame pixels differ from snapshot').toEqual(expected.frames);
    expect(actual.variant, 'styled/teach frames differ from snapshot').toEqual(expected.variant);

    const { report } = await call('exportRiff', text, variant.fps, variant.style, variant.teach, variant.tone);
    console.log(`${file} [${variant.style.layout}, ${variant.tone} tone, ${JSON.stringify(variant.teach)}, ${variant.fps} fps]: ${report.matched}/${report.total} matched, max error ${report.maxAbsErrorMs.toFixed(1)} ms`);
    if (!report.ok) console.log(report.matches.filter((m) => !m.ok).map((m) => m.detail).slice(0, 10));
    expect(report.ok, 'Sync Report must be green').toBe(true);
  });
}
