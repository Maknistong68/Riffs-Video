/** Dev-only page logic for `npm run golden` and pipeline debugging. Not part of the app build. */
import { DEFAULT_DRUMS, type DrumPattern } from '../../src/audio/drums';
import { DEFAULT_SOUND_PACK } from '../../src/audio/soundpacks';
import { programOf, tonePreset } from '../../src/audio/tone';
import { buildArrangement, NO_TEACH, type TeachOptions } from '../../src/engine/arrange';
import { isPlainTeach } from '../../src/engine/teach';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import type { RenderStyle } from '../../src/render/style';
import { loadAlphaTex } from '../../src/import/alphatab';
import { defaultFrameSettings, drawFrame } from '../../src/render/drawFrame';
import { loadRenderFonts } from '../../src/render/fonts';
import { ensureNeck3d } from '../../src/render/neck3dRegistry';
import { startExport } from '../../src/workers/client';

async function sha256(data: Uint8ClampedArray): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const harness = {
  /** PNG data URLs of drawFrame output for a style / teach arrangement (visual review). */
  async renderFrames(text: string, frames: number[], style: Partial<RenderStyle> = {}, teach: TeachOptions = NO_TEACH, timing: { leadInMs?: number; tailMs?: number } = {}) {
    await loadRenderFonts();
    if (style.view === '3d' && !(await ensureNeck3d())) throw new Error('WebGL unavailable');
    const { timeline } = buildArrangement(() => loadAlphaTex(text), { trackIndex: 0, leadInMs: timing.leadInMs ?? DEFAULT_BUILD.leadInMs, tailMs: timing.tailMs ?? DEFAULT_BUILD.tailMs, teach });
    const s = defaultFrameSettings(30, style);
    const canvas = new OffscreenCanvas(s.width, s.height);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const out: string[] = [];
    for (const f of frames) {
      drawFrame(ctx, timeline, f, s);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      out.push(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); }));
    }
    return { out, sections: timeline.sections ?? [], durationMs: timeline.durationMs };
  },
  /** Timeline JSON + SHA-256 of drawFrame pixels for the given frames (30 fps). */
  async frameHashes(text: string, frames: number[], style: Partial<RenderStyle> = {}, teach: TeachOptions = NO_TEACH, timing: { leadInMs?: number; tailMs?: number } = {}) {
    const fontOk = await loadRenderFonts();
    if (style.view === '3d' && !(await ensureNeck3d())) throw new Error('WebGL unavailable');
    const timeline =
      !isPlainTeach(teach)
        ? buildArrangement(() => loadAlphaTex(text), { trackIndex: 0, leadInMs: timing.leadInMs ?? DEFAULT_BUILD.leadInMs, tailMs: timing.tailMs ?? DEFAULT_BUILD.tailMs, teach }).timeline
        : buildTimeline(loadAlphaTex(text), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
    const s = defaultFrameSettings(30, style);
    const canvas = new OffscreenCanvas(s.width, s.height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const hashes: string[] = [];
    for (const f of frames) {
      drawFrame(ctx, timeline, f, s);
      hashes.push(await sha256(ctx.getImageData(0, 0, s.width, s.height).data));
    }
    return { fontOk, timeline, hashes };
  },
  /** Full on-device export through the real worker; returns report + size (no MP4 bytes). */
  async exportRiff(text: string, fps: 30 | 60, style: Partial<RenderStyle> = {}, teach: TeachOptions = NO_TEACH, tonePresetId = 'clean', timing: { leadInMs?: number; tailMs?: number } = {}, drums?: DrumPattern) {
    const tone = tonePreset(tonePresetId);
    const stages: string[] = [];
    const job = startExport(
      {
        riff: { source: { kind: 'alphatex', text }, trackIndex: 0, leadInMs: timing.leadInMs ?? DEFAULT_BUILD.leadInMs, ...(timing.tailMs !== undefined ? { tailMs: timing.tailMs } : {}), teach, program: programOf(tone.instrument) },
        fps,
        style: defaultFrameSettings(fps, style).style,
        soundMode: 'synth',
        tone,
        ...(drums ? { drums: { ...DEFAULT_DRUMS, pattern: drums } } : {}),
        soundFontUrl: DEFAULT_SOUND_PACK.url,
        modelUrl: new URL('/models/basic-pitch/model.json', location.href).href,
      },
      (stage) => {
        if (stages[stages.length - 1] !== stage) stages.push(stage);
      },
    );
    const r = await job.promise;
    return { report: r.report, info: r.info, warnings: r.warnings, stages, notes: r.timeline.events.length };
  },
};

(window as unknown as { harness: typeof harness }).harness = harness;
