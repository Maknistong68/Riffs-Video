/**
 * Sync Report (CLAUDE.md §3): decode the exported MP4 and prove it matches the timeline.
 *  1. audio: spectral-flux onsets within ±1 frame + Basic Pitch pitches (syncCheck.matchNotes)
 *  2. audio and video stream durations within 1 frame
 *  3. 5 decoded frames vs drawFrame output (PSNR; H.264 is lossy so exact hashes can't survive)
 *  4. finger dots appear on each note's first frame and not on the frame before
 */
import { ALL_FORMATS, AudioSampleSink, BufferSource, CanvasSink, Input } from 'mediabunny';
import { detectOnsets } from '../audio/onsets';
import type { DetectedNote } from '../audio/transcribe';
import { AUDIO_SAMPLE_RATE, firstFrameAtOrAfter, frameToMs } from '../engine/time';
import { activeEvents, type Timeline } from '../engine/timeline';
import { classicLayout, drawFrame, visibleFrets, type FrameSettings } from '../render/drawFrame';
import { DOT_RADIUS, dotPosition } from '../render/neck2d';
import { pickSampleFrames, psnr } from './frameCompare';
import { matchNotes, type HighlightCheck, type SyncReport } from './syncCheck';

export const MIN_FRAME_PSNR = 30;
const MAX_HIGHLIGHT_CHECKS = 48;

export type VerifyStage = 'audio' | 'pitch' | 'frames';

export async function verifyExport(
  data: ArrayBuffer,
  t: Timeline,
  settings: FrameSettings,
  totalFrames: number,
  transcribeFn: (mono: Float32Array, sampleRate: number) => Promise<DetectedNote[]>,
  onStage: (s: VerifyStage) => void = () => undefined,
): Promise<SyncReport> {
  const fps = settings.fps;
  const toleranceMs = 1000 / fps;
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(data) });
  const audioTrack = await input.getPrimaryAudioTrack();
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!audioTrack || !videoTrack) throw new Error('Exported file is missing an audio or video track');

  onStage('audio');
  const audioSec = await audioTrack.computeDuration();
  const mono = await decodeMono(audioTrack, audioSec);
  const onsets = detectOnsets(mono, AUDIO_SAMPLE_RATE);
  onStage('pitch');
  const detected = await transcribeFn(mono, AUDIO_SAMPLE_RATE);
  const { matches, extras } = matchNotes(t, detected, onsets, fps);
  const checked = matches.filter((m) => m.kind !== 'skipped');
  const matched = checked.filter((m) => m.ok).length;
  const maxAbsErrorMs = Math.max(0, ...checked.map((m) => Math.abs(m.errorMs ?? 0)));

  const videoSec = await videoTrack.computeDuration();
  const diffMs = Math.abs(videoSec - audioSec) * 1000;
  const durations = { videoSec, audioSec, diffMs, ok: diffMs <= toleranceMs };

  onStage('frames');
  const sink = new CanvasSink(videoTrack, { poolSize: 2 });
  const ref = new OffscreenCanvas(settings.width, settings.height);
  const refCtx = ref.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!refCtx) throw new Error('OffscreenCanvas 2D context unavailable');

  // 3. Sample frames vs drawFrame
  const onsetFrames = [...new Set(t.events.map((e) => firstFrameAtOrAfter(e.startMs, fps)))];
  const sampleFrames = pickSampleFrames(onsetFrames, totalFrames);
  const frames: SyncReport['frames'] = [];
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(sampleFrames.map((f) => (f + 0.5) / fps))) {
    const f = sampleFrames[i++]!;
    if (!wc) {
      frames.push({ frame: f, psnr: 0, ok: false });
      continue;
    }
    const decoded = context2d(wc.canvas).getImageData(0, 0, settings.width, settings.height).data;
    drawFrame(refCtx, t, f, settings);
    const p = psnr(decoded, refCtx.getImageData(0, 0, settings.width, settings.height).data);
    frames.push({ frame: f, psnr: p, ok: p >= MIN_FRAME_PSNR });
  }

  // 4. Highlight timing
  const { neck } = classicLayout(settings, t.tuning.length, visibleFrets(t));
  const dot = hexToRgb(settings.theme.dot);
  const step = Math.max(1, Math.ceil(t.events.length / MAX_HIGHLIGHT_CHECKS));
  const probes = t.events
    .filter((_, k) => k % step === 0)
    .map((e) => {
      const f = firstFrameAtOrAfter(e.startMs, fps);
      const occupiedBefore =
        f === 0 || activeEvents(t, frameToMs(f - 1, fps)).some((o) => o.stringIdx === e.stringIdx && o.fret === e.fret);
      const p = dotPosition(neck, e.stringIdx, e.fret);
      // Sample above the fret number and clear of the vibrating string line.
      return { e, f, occupiedBefore, x: Math.round(p.x), y: Math.round(p.y - (e.fret === 0 ? DOT_RADIUS - 6 : 19)) };
    });
  const wanted = [...new Set(probes.flatMap((p) => (p.occupiedBefore ? [p.f] : [p.f - 1, p.f])))].sort((a, b) => a - b);
  const pixel = new Map<string, readonly number[]>();
  let w = 0;
  for await (const wc of sink.canvasesAtTimestamps(wanted.map((f) => (f + 0.5) / fps))) {
    const f = wanted[w++]!;
    if (!wc) continue;
    const c = context2d(wc.canvas);
    for (const p of probes) {
      if (p.f !== f && p.f - 1 !== f) continue;
      const d = c.getImageData(p.x - 1, p.y - 1, 3, 3).data;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < d.length; k += 4) { r += d[k]!; g += d[k + 1]!; b += d[k + 2]!; }
      pixel.set(`${p.e.id}@${f}`, [r / 9, g / 9, b / 9]);
    }
  }
  const near = (c: readonly number[] | undefined) =>
    c !== undefined && Math.hypot(c[0]! - dot[0], c[1]! - dot[1], c[2]! - dot[2]) < 70;
  const highlights: HighlightCheck[] = probes.map((p) => {
    const okOn = near(pixel.get(`${p.e.id}@${p.f}`));
    const okOff = p.occupiedBefore || !near(pixel.get(`${p.e.id}@${p.f - 1}`));
    return {
      eventId: p.e.id,
      frame: p.f,
      ok: okOn && okOff,
      detail: okOn ? (okOff ? 'appears on its first frame' : 'visible one frame early') : 'not visible on its first frame',
    };
  });

  const ok =
    checked.every((m) => m.ok) && durations.ok && frames.every((f) => f.ok) && highlights.every((h) => h.ok);
  return { ok, fps, toleranceMs, matched, total: checked.length, maxAbsErrorMs, matches, extras, durations, frames, highlights };
}

async function decodeMono(track: ConstructorParameters<typeof AudioSampleSink>[0], durationSec: number): Promise<Float32Array> {
  const pcm = new Float32Array(Math.ceil(durationSec * AUDIO_SAMPLE_RATE) + AUDIO_SAMPLE_RATE);
  for await (const s of new AudioSampleSink(track).samples()) {
    if (s.sampleRate !== AUDIO_SAMPLE_RATE) throw new Error(`Unexpected audio sample rate ${s.sampleRate}`);
    const offset = Math.round(s.timestamp * s.sampleRate);
    const tmp = new Float32Array(s.numberOfFrames);
    for (let c = 0; c < s.numberOfChannels; c++) {
      s.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
      for (let k = 0; k < tmp.length; k++) {
        const j = offset + k;
        if (j >= 0 && j < pcm.length) pcm[j]! += tmp[k]! / s.numberOfChannels;
      }
    }
    s.close();
  }
  return pcm;
}

function context2d(canvas: HTMLCanvasElement | OffscreenCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const c = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!c) throw new Error('Cannot read decoded frame');
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
