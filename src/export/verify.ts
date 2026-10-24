import { ALL_FORMATS, AudioSampleSink, BufferSource, CanvasSink, Input } from 'mediabunny';
import { detectOnsets } from '../audio/onsets';
import { AUDIO_SAMPLE_RATE, firstFrameAtOrAfter, frameToMs } from '../engine/time';
import { activeEvents, type Timeline } from '../engine/timeline';
import { classicLayout, defaultFrameSettings } from '../render/drawFrame';
import { DOT_RADIUS, dotPosition } from '../render/neck2d';
import { matchOnsets, type SyncReport } from './syncCheck';

/**
 * Phase 0 Sync Report: decode the exported MP4 and check
 *  1. every note's beep onset is within ±1 frame of the timeline,
 *  2. audio and video stream durations match within 1 frame,
 *  3. the finger dot is visible on the first frame of each note and absent on the frame before.
 */
export async function verifyExport(data: ArrayBuffer, t: Timeline, fps: number): Promise<SyncReport> {
  const toleranceMs = 1000 / fps;
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(data) });
  const audioTrack = await input.getPrimaryAudioTrack();
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!audioTrack || !videoTrack) throw new Error('Exported file is missing an audio or video track');

  // 1. Audio onsets
  const audioSec = await audioTrack.computeDuration();
  const pcm = new Float32Array(Math.ceil(audioSec * AUDIO_SAMPLE_RATE) + AUDIO_SAMPLE_RATE);
  const sink = new AudioSampleSink(audioTrack);
  let sampleRate = AUDIO_SAMPLE_RATE;
  for await (const s of sink.samples()) {
    sampleRate = s.sampleRate;
    const offset = Math.round(s.timestamp * s.sampleRate);
    const tmp = new Float32Array(s.numberOfFrames);
    s.copyTo(tmp, { planeIndex: 0, format: 'f32-planar' });
    s.close();
    for (let i = 0; i < tmp.length; i++) {
      const j = offset + i;
      if (j >= 0 && j < pcm.length) pcm[j] = tmp[i]!;
    }
  }
  const onsets = detectOnsets(pcm, sampleRate);
  const { matches, extraOnsets } = matchOnsets(t, onsets, toleranceMs);
  const matched = matches.filter((m) => m.ok).length;
  const maxAbsErrorMs = Math.max(0, ...matches.map((m) => Math.abs(m.errorMs ?? Infinity)));

  // 2. Stream durations
  const videoSec = await videoTrack.computeDuration();
  const diffMs = Math.abs(videoSec - audioSec) * 1000;
  const durations = { videoSec, audioSec, diffMs, ok: diffMs <= toleranceMs };

  // 3. Visual highlight timing
  const settings = defaultFrameSettings(fps);
  const { neck } = classicLayout(settings, t.tuning.length);
  const canvasSink = new CanvasSink(videoTrack, { poolSize: 2 });
  const dot = hexToRgb(settings.theme.dot);
  const highlights: SyncReport['highlights'] = [];
  for (const e of t.events) {
    const f = firstFrameAtOrAfter(e.startMs, fps);
    const p = dotPosition(neck, e.stringIdx, e.fret);
    // Sample the dot body above the fret number and clear of the (vibrating, highlighted)
    // string line; for open strings sample the top of the ring.
    const sx = p.x;
    const sy = p.y - (e.fret === 0 ? DOT_RADIUS - 6 : 19);
    const colorAt = async (frame: number) => {
      const wc = await canvasSink.getCanvas((frame + 0.5) / fps);
      if (!wc) return null;
      const c = wc.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!c) return null;
      const d = c.getImageData(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; }
      const n = d.length / 4;
      return [r / n, g / n, b / n] as const;
    };
    const near = (c: readonly number[] | null) =>
      c !== null && Math.hypot(c[0]! - dot[0], c[1]! - dot[1], c[2]! - dot[2]) < 70;

    const on = await colorAt(f);
    // The frame before must NOT show this dot, unless another note occupies the same spot then.
    const prevMs = frameToMs(f - 1, fps);
    const occupiedBefore = activeEvents(t, prevMs).some((o) => o.stringIdx === e.stringIdx && o.fret === e.fret);
    const off = f > 0 && !occupiedBefore ? await colorAt(f - 1) : null;
    const okOn = near(on);
    const okOff = f === 0 || occupiedBefore || !near(off);
    highlights.push({
      eventId: e.id,
      frame: f,
      ok: okOn && okOff,
      detail: okOn ? (okOff ? 'appears on its first frame' : 'visible one frame early') : 'not visible on its first frame',
    });
  }

  const ok =
    matched === matches.length && extraOnsets.length === 0 && durations.ok && highlights.every((h) => h.ok);
  return { ok, toleranceMs, matched, total: matches.length, extraOnsets, matches, maxAbsErrorMs, durations, highlights };
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
