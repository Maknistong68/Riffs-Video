import type { NoteEvent, Timeline } from '../engine/timeline';
import { font } from './fonts';
import type { Theme } from './theme';
import type { Ctx2D } from './drawFrame';

export type LaneGeometry = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  playheadX: number;
  pxPerMs: number;
};

export function laneLineY(g: LaneGeometry, stringIdx: number, strings: number): number {
  const pad = 34;
  return g.y0 + pad + ((g.y1 - g.y0 - 2 * pad) * stringIdx) / (strings - 1);
}

export function drawTabLane(ctx: Ctx2D, g: LaneGeometry, t: Timeline, theme: Theme, ms: number): void {
  const strings = t.tuning.length;
  ctx.fillStyle = theme.laneBg;
  roundRect(ctx, g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, 24);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
  ctx.clip();

  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 2;
  for (let s = 0; s < strings; s++) {
    const y = laneLineY(g, s, strings);
    ctx.beginPath();
    ctx.moveTo(g.x0, y);
    ctx.lineTo(g.x1, y);
    ctx.stroke();
  }

  // Bar lines
  ctx.strokeStyle = theme.textDim;
  for (const b of t.bars) {
    const x = g.playheadX + (b.startMs - ms) * g.pxPerMs - 30;
    if (x < g.x0 || x > g.x1) continue;
    ctx.beginPath();
    ctx.moveTo(x, laneLineY(g, 0, strings));
    ctx.lineTo(x, laneLineY(g, strings - 1, strings));
    ctx.stroke();
  }

  ctx.font = font(700, 34);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of t.events) {
    const x = g.playheadX + (e.startMs - ms) * g.pxPerMs;
    if (x < g.x0 - 60 || x > g.x1 + 60) continue;
    const y = laneLineY(g, e.stringIdx, strings);
    const sounding = isSounding(e, ms);
    ctx.globalAlpha = ms >= e.startMs + e.durationMs ? 0.45 : 1;
    ctx.fillStyle = sounding ? theme.noteBoxActive : theme.noteBox;
    roundRect(ctx, x - 26, y - 22, 52, 44, 10);
    ctx.fill();
    ctx.fillStyle = sounding ? theme.dotText : theme.noteText;
    ctx.fillText(String(e.fret), x, y + 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.fillStyle = theme.playhead;
  ctx.fillRect(g.playheadX - 3, g.y0 + 8, 6, g.y1 - g.y0 - 16);
}

function isSounding(e: NoteEvent, ms: number): boolean {
  return ms >= e.startMs && ms < e.startMs + e.durationMs;
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
