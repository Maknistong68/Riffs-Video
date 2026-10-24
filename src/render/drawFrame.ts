import { frameToMs } from '../engine/time';
import { lastNotePerString, type Timeline } from '../engine/timeline';
import { drawNeck, type NeckGeometry } from './neck2d';
import { drawTabLane, type LaneGeometry } from './tabLane';
import { font } from './fonts';
import { DARK_THEME, SAFE_ZONES, type Theme } from './theme';
import { tuningLabel } from '../engine/tuning';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type FrameSettings = {
  fps: number;
  width: number;
  height: number;
  theme: Theme;
  safeZones: typeof SAFE_ZONES;
  showSafeZones: boolean;
};

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;

export function defaultFrameSettings(fps: number): FrameSettings {
  return {
    fps,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    theme: DARK_THEME,
    safeZones: SAFE_ZONES,
    showSafeZones: false,
  };
}

/** Classic layout geometry (title top, neck middle, tab lane bottom), inside the safe zones. */
/** Visible frets: enough for the highest note in the riff (12, 15, 19 or 24). */
export function visibleFrets(t: Pick<Timeline, 'events'>): number {
  const max = t.events.reduce((m, e) => Math.max(m, e.fret), 0);
  return [12, 15, 19, 24].find((f) => max < f) ?? 24;
}

export function classicLayout(s: FrameSettings, strings: number, frets = 12): { neck: NeckGeometry; lane: LaneGeometry } {
  const right = s.width - s.safeZones.rightPx;
  const bottom = s.height - s.safeZones.bottomPx;
  const neck: NeckGeometry = { x0: 110, x1: right - 20, y0: 640, y1: 940, frets, strings };
  const lane: LaneGeometry = { x0: 40, x1: right, y0: 1110, y1: bottom - 40, playheadX: 260, pxPerMs: 0.55 };
  return { neck, lane };
}

function currentBpm(t: Timeline, ms: number): number {
  let bpm = t.tempoMap[0]?.bpm ?? 0;
  for (const x of t.tempoMap) if (x.ms <= ms) bpm = x.bpm;
  return bpm;
}

/**
 * Pure frame renderer: output depends only on (timeline, frameIndex, settings).
 * No clocks, no randomness. Used by the live preview AND the exporter.
 */
export function drawFrame(ctx: Ctx2D, t: Timeline, frameIndex: number, s: FrameSettings): void {
  const ms = frameToMs(frameIndex, s.fps);
  const th = s.theme;
  const { neck, lane } = classicLayout(s, t.tuning.length, visibleFrets(t));

  ctx.save();
  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, s.width, s.height);

  // Title
  ctx.fillStyle = th.text;
  ctx.font = font(800, 64);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(t.title, 60, s.safeZones.topPx + 160, s.width - s.safeZones.rightPx - 100);
  ctx.fillStyle = th.textDim;
  ctx.font = font(500, 34);
  const bpm = Math.round(currentBpm(t, ms));
  ctx.fillText(`${bpm} bpm · ${tuningLabel(t.tuning, t.capo)}`, 60, s.safeZones.topPx + 220);

  drawNeck(ctx, neck, th, ms, lastNotePerString(t, ms));
  drawTabLane(ctx, lane, t, th, ms);

  // Progress bar (above the caption safe zone)
  const barY = s.height - s.safeZones.bottomPx - 14;
  const right = s.width - s.safeZones.rightPx;
  ctx.fillStyle = th.laneLine;
  ctx.fillRect(40, barY, right - 40, 6);
  ctx.fillStyle = th.playhead;
  ctx.fillRect(40, barY, (right - 40) * Math.min(1, ms / t.durationMs), 6);

  if (s.showSafeZones) {
    ctx.fillStyle = 'rgba(255, 60, 60, 0.25)';
    ctx.fillRect(s.width - s.safeZones.rightPx, 0, s.safeZones.rightPx, s.height);
    ctx.fillRect(0, s.height - s.safeZones.bottomPx, s.width, s.safeZones.bottomPx);
    ctx.fillRect(0, 0, s.width, s.safeZones.topPx);
  }
  ctx.restore();
}
