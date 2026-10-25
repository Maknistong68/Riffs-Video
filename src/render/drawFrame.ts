import { frameToMs } from '../engine/time';
import { tuningLabel } from '../engine/tuning';
import type { Timeline } from '../engine/timeline';
import { font } from './fonts';
import { layoutGeometry } from './layouts';
import { drawNeck } from './neck2d';
import { drawNotation } from './notation';
import { SKINS } from './skins';
import { DEFAULT_STYLE, type RenderStyle } from './style';
import { drawTabLane, roundRect } from './tabLane';
import { DARK_THEME, SAFE_ZONES, type Theme } from './theme';

export { visibleFrets } from './layouts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type FrameSettings = {
  fps: number;
  width: number;
  height: number;
  theme: Theme;
  safeZones: typeof SAFE_ZONES;
  showSafeZones: boolean;
  style: RenderStyle;
};

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;

export function defaultFrameSettings(fps: number, style: Partial<RenderStyle> = {}): FrameSettings {
  return {
    fps,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    theme: DARK_THEME,
    safeZones: SAFE_ZONES,
    showSafeZones: false,
    style: { ...DEFAULT_STYLE, ...style },
  };
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
  const geo = layoutGeometry(s, t, ms);
  const right = s.width - s.safeZones.rightPx;

  ctx.save();
  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, s.width, s.height);

  drawHeader(ctx, t, s, ms);
  drawSection(ctx, t, s, ms);

  drawNeck(ctx, geo.neck, SKINS[s.style.skin], th, t, ms, s.style, geo.numbersOnNeck);
  if (geo.lane) drawTabLane(ctx, geo.lane, t, th, ms, s.style);
  if (geo.notation) drawNotation(ctx, geo.notation, t, th, ms);

  // Progress bar (above the caption safe zone)
  const barY = s.height - s.safeZones.bottomPx - 14;
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

function drawHeader(ctx: Ctx2D, t: Timeline, s: FrameSettings, ms: number): void {
  const th = s.theme;
  const top = s.safeZones.topPx;
  const maxW = s.width - s.safeZones.rightPx - 100;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = th.text;
  ctx.font = font(800, 64);
  ctx.fillText(t.title, 60, top + 160, maxW);
  ctx.fillStyle = th.textDim;
  ctx.font = font(500, 34);
  ctx.fillText(`${Math.round(currentBpm(t, ms))} bpm · ${tuningLabel(t.tuning, t.capo)}`, 60, top + 216, maxW);
  let x = 60;
  const y = top + 262;
  if (s.style.difficulty !== 'none') {
    const label = s.style.difficulty;
    ctx.font = font(700, 28);
    const w = ctx.measureText(label).width + 32;
    ctx.fillStyle = { Easy: '#2e7d4f', Medium: '#9a6a12', Hard: '#a33a3a' }[label];
    roundRect(ctx, x, y - 30, w, 42, 21);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 16, y);
    x += w + 16;
  }
  if (s.style.credit) {
    ctx.fillStyle = th.textDim;
    ctx.font = font(500, 28);
    ctx.fillText(s.style.credit, x, y, maxW - (x - 60));
  }
}

/** Teach captions: "Slow · 50%", "Loop 2/3 · bar 3", "Full speed". */
function drawSection(ctx: Ctx2D, t: Timeline, s: FrameSettings, ms: number): void {
  const sec = t.sections?.find((x) => ms >= x.startMs - 400 && ms < x.endMs + 400);
  if (!sec) return;
  const th = s.theme;
  ctx.font = font(800, 36);
  const w = ctx.measureText(sec.label).width + 56;
  const cx = (s.width - s.safeZones.rightPx) / 2 + 20;
  const y = s.safeZones.topPx + 330;
  ctx.fillStyle = th.noteBoxActive;
  roundRect(ctx, cx - w / 2, y - 30, w, 60, 30);
  ctx.fill();
  ctx.fillStyle = th.dotText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sec.label, cx, y + 1);
}
