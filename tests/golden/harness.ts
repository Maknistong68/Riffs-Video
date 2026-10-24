/** Dev-only page logic for `npm run golden` and pipeline debugging. Not part of the app build. */
import { DEFAULT_SOUND_PACK } from '../../src/audio/soundpacks';
import { buildTimeline, DEFAULT_BUILD } from '../../src/engine/buildTimeline';
import { loadAlphaTex } from '../../src/import/alphatab';
import { defaultFrameSettings, drawFrame } from '../../src/render/drawFrame';
import { loadRenderFonts } from '../../src/render/fonts';
import { startExport } from '../../src/workers/client';

async function sha256(data: Uint8ClampedArray): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const harness = {
  /** Timeline JSON + SHA-256 of drawFrame pixels for the given frames (30 fps). */
  async frameHashes(text: string, frames: number[]) {
    const fontOk = await loadRenderFonts();
    const { timeline } = buildTimeline(loadAlphaTex(text), { ...DEFAULT_BUILD, trackIndex: 0 });
    const s = defaultFrameSettings(30);
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
  async exportRiff(text: string, fps: 30 | 60) {
    const stages: string[] = [];
    const job = startExport(
      {
        riff: { source: { kind: 'alphatex', text }, trackIndex: 0, leadInMs: DEFAULT_BUILD.leadInMs },
        fps,
        soundMode: 'synth',
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
