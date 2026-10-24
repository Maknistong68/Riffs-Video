import type { NoteEvent } from '../engine/timeline';
import { font } from './fonts';
import type { Theme } from './theme';
import type { Ctx2D } from './drawFrame';

export type NeckGeometry = {
  x0: number; // nut x
  x1: number; // last visible fret x
  y0: number;
  y1: number;
  frets: number; // visible frets
  strings: number;
};

/** Fret wire x position using the real equal-temperament spacing, scaled to fit `frets`. */
export function fretX(g: NeckGeometry, fret: number): number {
  const scale = 1 - 2 ** (-g.frets / 12);
  return g.x0 + ((g.x1 - g.x0) * (1 - 2 ** (-fret / 12))) / scale;
}

export function stringY(g: NeckGeometry, stringIdx: number): number {
  const pad = (g.y1 - g.y0) * 0.09;
  return g.y0 + pad + ((g.y1 - g.y0 - 2 * pad) * stringIdx) / (g.strings - 1);
}

/** Centre of the finger dot for a note; open strings sit just left of the nut. */
export function dotPosition(g: NeckGeometry, stringIdx: number, fret: number): { x: number; y: number } {
  const y = stringY(g, stringIdx);
  if (fret === 0) return { x: g.x0 - 34, y };
  return { x: (fretX(g, fret - 1) + fretX(g, fret)) / 2, y };
}

export const DOT_RADIUS = 26;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/** String displacement envelope: deterministic in time since the note was struck. */
export function vibrationAmplitude(sinceStrikeMs: number, durationMs: number): number {
  if (sinceStrikeMs < 0 || sinceStrikeMs >= durationMs) return 0;
  return 12 * Math.exp(-sinceStrikeMs / 220);
}

export function drawNeck(
  ctx: Ctx2D,
  g: NeckGeometry,
  theme: Theme,
  ms: number,
  perString: readonly (NoteEvent | null)[],
): void {
  // Fretboard
  ctx.fillStyle = theme.woodEdge;
  ctx.fillRect(g.x0 - 6, g.y0 - 6, g.x1 - g.x0 + 12, g.y1 - g.y0 + 12);
  ctx.fillStyle = theme.wood;
  ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);

  // Inlays
  ctx.fillStyle = theme.inlay;
  const midY = (g.y0 + g.y1) / 2;
  for (let f = 1; f <= g.frets; f++) {
    const cx = (fretX(g, f - 1) + fretX(g, f)) / 2;
    if (f % 12 === 0) {
      const dy = (g.y1 - g.y0) * 0.22;
      circle(ctx, cx, midY - dy, 9);
      circle(ctx, cx, midY + dy, 9);
    } else if (INLAYS.includes(f)) {
      circle(ctx, cx, midY, 9);
    }
  }

  // Nut + frets
  ctx.fillStyle = theme.nut;
  ctx.fillRect(g.x0 - 8, g.y0, 10, g.y1 - g.y0);
  ctx.fillStyle = theme.fretWire;
  for (let f = 1; f <= g.frets; f++) ctx.fillRect(fretX(g, f) - 2.5, g.y0, 5, g.y1 - g.y0);

  // Fret numbers under the neck
  ctx.fillStyle = theme.textDim;
  ctx.font = font(600, 26);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
    if (f <= g.frets) ctx.fillText(String(f), (fretX(g, f - 1) + fretX(g, f)) / 2, g.y1 + 18);
  }

  // Strings (thicker for lower strings); the struck one lights up and vibrates
  for (let s = 0; s < g.strings; s++) {
    const y = stringY(g, s);
    const width = 2 + s * 0.9;
    const e = perString[s] ?? null;
    const amp = e ? vibrationAmplitude(ms - e.startMs, e.durationMs) : 0;
    ctx.lineWidth = width;
    if (amp > 0 && e) {
      ctx.strokeStyle = theme.stringActive;
      const from = e.fret === 0 ? g.x0 : fretX(g, e.fret);
      // Visual oscillation phase is a pure function of time since the strike.
      const phase = Math.cos(((ms - e.startMs) / 1000) * 2 * Math.PI * 11);
      ctx.beginPath();
      ctx.moveTo(g.x0 - 40, y);
      ctx.lineTo(from, y);
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        ctx.lineTo(from + (g.x1 + 14 - from) * t, y + amp * phase * Math.sin(Math.PI * t));
      }
      ctx.stroke();
    } else {
      ctx.strokeStyle = theme.string;
      ctx.beginPath();
      ctx.moveTo(g.x0 - 40, y);
      ctx.lineTo(g.x1 + 14, y);
      ctx.stroke();
    }
  }

  // Finger dots for sounding notes
  for (const e of perString) {
    if (!e || ms >= e.startMs + e.durationMs) continue;
    const p = dotPosition(g, e.stringIdx, e.fret);
    ctx.fillStyle = theme.dot;
    if (e.fret === 0) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = theme.dot;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_RADIUS - 6, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      circle(ctx, p.x, p.y, DOT_RADIUS);
      ctx.fillStyle = theme.dotText;
      ctx.font = font(700, 26);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(e.fret), p.x, p.y + 1);
    }
  }
}

function circle(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
