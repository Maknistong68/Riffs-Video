/**
 * Fretboard drawing. A NeckView is a window onto frets [fromFret, toFret] with real
 * equal-temperament spacing, optionally mirrored (left-handed). Everything here is a pure
 * function of (timeline, ms, view, style).
 */
import { noteName } from '../engine/tuning';
import { lastNotePerString, upperBound, type NoteEvent, type Timeline } from '../engine/timeline';
import type { Ctx2D } from './drawFrame';
import { font } from './fonts';
import type { Skin } from './skins';
import type { RenderStyle } from './style';
import type { Theme } from './theme';

export type NeckView = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Fret position at the left (or right, if mirrored) edge; 0 = nut. May be fractional. */
  fromFret: number;
  toFret: number;
  strings: number;
  mirror: boolean;
  /**
   * 3D view: screen position of a point on the neck (fractional fret wire position, fractional
   * string index) and its size relative to the flat view. Unset = the flat 2D fretboard.
   */
  proj?: Projector;
};

export type Projector = (fret: number, stringIdx: number) => { x: number; y: number; scale: number };

/** How long before a note its ghost ring appears. */
export const LOOKAHEAD_MS = 450;
const SLIDE_MS = 160;
const BEND_RISE_MS = 220;

const pos = (f: number) => 1 - 2 ** (-f / 12);

/** Screen x of a fret wire (fractional frets allowed). */
export function fretX(v: NeckView, fret: number): number {
  const u = (pos(fret) - pos(v.fromFret)) / (pos(v.toFret) - pos(v.fromFret));
  const x = v.x0 + u * (v.x1 - v.x0);
  return v.mirror ? v.x0 + v.x1 - x : x;
}

export function stringSpacing(v: NeckView): number {
  const pad = (v.y1 - v.y0) * 0.09;
  return (v.y1 - v.y0 - 2 * pad) / Math.max(1, v.strings - 1);
}

export function stringY(v: NeckView, stringIdx: number): number {
  const pad = (v.y1 - v.y0) * 0.09;
  return v.y0 + pad + stringSpacing(v) * stringIdx;
}

export function dotRadius(v: NeckView): number {
  return Math.max(14, Math.min(34, stringSpacing(v) * 0.44));
}

/** Fret value halfway (in real distance) between wires f-1 and f: where a fretted dot sits. */
export function midFret(f: number): number {
  return -12 * Math.log2(1 - (pos(f - 1) + pos(f)) / 2);
}

/** Size multiplier of a dot at this note (perspective in 3D, 1 when flat). */
export function dotScale(v: NeckView, stringIdx: number, fret: number): number {
  if (!v.proj) return 1;
  return v.proj(fret === 0 ? Math.max(0, v.fromFret) - 0.6 : midFret(fret), stringIdx).scale;
}

/** Centre of a note's dot; open strings sit just outside the nut (or the visible edge). */
export function dotPosition(v: NeckView, stringIdx: number, fret: number): { x: number; y: number } {
  if (v.proj) {
    const p = v.proj(fret === 0 ? Math.max(0, v.fromFret) - 0.6 : midFret(fret), stringIdx);
    return { x: p.x, y: p.y };
  }
  const y = stringY(v, stringIdx);
  if (fret === 0) {
    const edge = fretX(v, Math.max(0, v.fromFret));
    const out = dotRadius(v) + 10;
    return { x: edge + (v.mirror ? out : -out), y };
  }
  return { x: (fretX(v, fret - 1) + fretX(v, fret)) / 2, y };
}

/**
 * Where to sample the dot colour on a note's first frame (Sync Report), or null when the
 * note is not drawn as a plain filled dot then (dead note X, slide destination in motion).
 */
export function noteProbe(v: NeckView, e: NoteEvent): { x: number; y: number } | null {
  if (e.tech.includes('dead') || e.legato) return null;
  const p = dotPosition(v, e.stringIdx, e.fret);
  const r = dotRadius(v) * dotScale(v, e.stringIdx, e.fret);
  if (e.tech.includes('harmonic')) return { x: p.x, y: p.y - r * 0.55 };
  return { x: p.x, y: p.y - r * 0.73 };
}

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/** String displacement envelope: deterministic in time since the note was struck. */
export function vibrationAmplitude(sinceStrikeMs: number, durationMs: number): number {
  if (sinceStrikeMs < 0 || sinceStrikeMs >= durationMs) return 0;
  return 12 * Math.exp(-sinceStrikeMs / 220);
}

/** The note played before `e` on the same string (for h/p arcs and slides). */
export function previousOnString(t: Timeline, e: NoteEvent): NoteEvent | null {
  let i = upperBound(t.events, e.startMs - 0.5) - 1;
  for (let steps = 0; i >= 0 && steps < 64; i--, steps++) {
    const o = t.events[i]!;
    if (o.stringIdx === e.stringIdx && o.startMs < e.startMs) return o;
  }
  return null;
}

export function bendProgress(e: NoteEvent, ms: number): number {
  if (!e.bendSemitones) return 0;
  const rise = Math.min(BEND_RISE_MS, e.durationMs * 0.6);
  const p = Math.max(0, Math.min(1, (ms - e.startMs) / rise));
  return e.tech.includes('release') ? 1 - p : p;
}

export function drawNeck(ctx: Ctx2D, v: NeckView, skin: Skin, theme: Theme, t: Timeline, ms: number, style: RenderStyle, numbersOnNeck = false): void {
  if (v.proj) drawFretNumbers3d(ctx, v, theme);
  else drawFlatNeck(ctx, v, skin, theme, t, ms);
  drawNeckOverlay(ctx, v, theme, t, ms, style, numbersOnNeck);
}

/** Fret numbers under the neck, placed through the 3D projection. */
function drawFretNumbers3d(ctx: Ctx2D, v: NeckView, theme: Theme): void {
  const proj = v.proj!;
  ctx.save();
  ctx.fillStyle = theme.textDim;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of [1, 3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
    if (f - 1 >= v.fromFret - 0.05 && f <= v.toFret + 0.05 && (f > 1 || v.fromFret > 0.5)) {
      const p = proj(midFret(f), v.strings - 1 + 1.25);
      ctx.font = font(600, Math.round(26 * Math.max(0.6, Math.min(1.6, p.scale))));
      ctx.fillText(String(f), p.x, p.y);
    }
  }
  ctx.restore();
}

/** The flat fretboard: wood, inlays, nut, frets, fret numbers and the (vibrating) strings. */
function drawFlatNeck(ctx: Ctx2D, v: NeckView, skin: Skin, theme: Theme, t: Timeline, ms: number): void {
  const left = Math.min(fretX(v, v.fromFret), fretX(v, v.toFret));
  const right = Math.max(fretX(v, v.fromFret), fretX(v, v.toFret));
  const w = right - left;
  const h = v.y1 - v.y0;

  // Board (clipped: a zoomed window may start mid-fret)
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - (v.fromFret <= 0 && !v.mirror ? 12 : 0), v.y0 - 8, w + (v.fromFret <= 0 ? 12 : 0), h + 16);
  ctx.clip();
  if (skin.binding) {
    ctx.fillStyle = skin.binding;
    ctx.fillRect(left, v.y0 - 7, w, h + 14);
  }
  ctx.fillStyle = skin.wood;
  ctx.fillRect(left, v.y0, w, h);
  ctx.strokeStyle = skin.woodGrain;
  ctx.lineWidth = 2;
  for (let k = 1; k < 9; k++) {
    // Deterministic grain lines (no randomness).
    const y = v.y0 + (h * k) / 9 + 3 * Math.sin(k * 1.7);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.bezierCurveTo(left + w * 0.33, y + 4 * Math.sin(k), left + w * 0.66, y - 4 * Math.cos(k), right, y + 2);
    ctx.stroke();
  }

  // Inlays (only inside the visible window)
  const midY = (v.y0 + v.y1) / 2;
  const firstFret = Math.max(1, Math.ceil(v.fromFret + 0.01));
  for (let f = firstFret; f <= Math.floor(v.toFret); f++) {
    if (skin.inlayShape === 'none') break;
    const cx = (fretX(v, f - 1) + fretX(v, f)) / 2;
    const fw = Math.abs(fretX(v, f) - fretX(v, f - 1));
    const isDouble = f % 12 === 0;
    if (!isDouble && !INLAYS.includes(f)) continue;
    ctx.fillStyle = skin.inlay;
    if (skin.inlayShape === 'dot') {
      const rr = Math.min(10, fw * 0.18);
      if (isDouble) {
        circle(ctx, cx, midY - h * 0.22, rr);
        circle(ctx, cx, midY + h * 0.22, rr);
      } else circle(ctx, cx, midY, rr);
    } else if (skin.inlayShape === 'block') {
      ctx.fillRect(cx - fw * 0.22, v.y0 + h * 0.3, fw * 0.44, h * 0.4);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - fw * 0.16, v.y0 + h * 0.26);
      ctx.lineTo(cx + fw * 0.16, v.y0 + h * 0.26);
      ctx.lineTo(cx + fw * 0.22, v.y1 - h * 0.26);
      ctx.lineTo(cx - fw * 0.22, v.y1 - h * 0.26);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Nut + frets
  if (v.fromFret <= 0) {
    ctx.fillStyle = skin.nut;
    const nx = fretX(v, 0);
    ctx.fillRect(v.mirror ? nx - 2 : nx - 10, v.y0, 12, h);
  }
  ctx.fillStyle = skin.fretWire;
  for (let f = Math.max(1, Math.ceil(v.fromFret)); f <= Math.floor(v.toFret); f++) {
    if (f <= v.fromFret) continue;
    ctx.fillRect(fretX(v, f) - 2.5, v.y0, 5, h);
  }

  ctx.restore();

  // Fret numbers under the neck (only frets fully in view)
  ctx.save();
  ctx.fillStyle = theme.textDim;
  ctx.font = font(600, 26);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const f of [1, 3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
    if (f - 1 >= v.fromFret - 0.05 && f <= v.toFret + 0.05 && (f > 1 || v.fromFret > 0.5)) {
      ctx.fillText(String(f), (fretX(v, f - 1) + fretX(v, f)) / 2, v.y1 + 16);
    }
  }
  ctx.restore();

  // Strings: the struck one lights up and vibrates from its fretted point
  const perString = lastNotePerString(t, ms);
  const firstWound = skin.firstWound(v.strings);
  const sLeft = left - (v.fromFret <= 0 ? 40 : 0);
  const sRight = right + (v.fromFret <= 0 ? 0 : 0);
  for (let s = 0; s < v.strings; s++) {
    const y = stringY(v, s);
    const e = perString[s] ?? null;
    const amp = e ? vibrationAmplitude(ms - e.startMs, e.durationMs) : 0;
    ctx.lineWidth = skin.gauge(s, v.strings);
    // Shadow under every string: keeps light strings readable on light (maple) boards.
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.moveTo(sLeft, y + ctx.lineWidth * 0.6 + 1);
    ctx.lineTo(sRight, y + ctx.lineWidth * 0.6 + 1);
    ctx.stroke();
    ctx.restore();
    if (amp > 0 && e) {
      ctx.strokeStyle = theme.stringActive;
      const from = e.fret === 0 ? fretX(v, Math.max(0, v.fromFret)) : fretX(v, e.fret);
      const bridge = v.mirror ? sLeft : sRight;
      const phase = Math.cos(((ms - e.startMs) / 1000) * 2 * Math.PI * 11);
      ctx.beginPath();
      ctx.moveTo(v.mirror ? sRight : sLeft, y);
      ctx.lineTo(from, y);
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        ctx.lineTo(from + (bridge - from) * u, y + amp * phase * Math.sin(Math.PI * u));
      }
      ctx.stroke();
    } else {
      ctx.strokeStyle = s >= firstWound ? skin.wound : skin.plain;
      ctx.beginPath();
      ctx.moveTo(sLeft, y);
      ctx.lineTo(sRight, y);
      ctx.stroke();
    }
  }

}

/** Everything drawn over the fretboard: look-ahead, technique links and the note dots. */
function drawNeckOverlay(ctx: Ctx2D, v: NeckView, theme: Theme, t: Timeline, ms: number, style: RenderStyle, numbersOnNeck: boolean): void {
  const r = dotRadius(v);
  const perString = lastNotePerString(t, ms);
  // Neck-Overlay: next notes appear on the neck as numbered markers with a closing ring.
  if (numbersOnNeck) drawNeckNumbers(ctx, v, t, theme, ms, r);
  // Look-ahead ghosts for the next notes
  else if (style.lookAhead) {
    const end = upperBound(t.events, ms + LOOKAHEAD_MS);
    for (let i = upperBound(t.events, ms); i < end; i++) {
      const e = t.events[i]!;
      const p = dotPosition(v, e.stringIdx, e.fret);
      const near = 1 - (e.startMs - ms) / LOOKAHEAD_MS;
      ctx.globalAlpha = 0.25 + 0.55 * near;
      ctx.strokeStyle = theme.ghost;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * dotScale(v, e.stringIdx, e.fret) * (1.25 - 0.25 * near), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Technique links (behind the dots): h/p arcs and slide lines
  const sounding = perString.filter((e): e is NoteEvent => e !== null && ms < e.startMs + e.durationMs && ms >= e.startMs);
  for (const e of sounding) {
    const isHP = e.tech.includes('hammer') || e.tech.includes('pull');
    const isSlideDest = e.tech.includes('slide') && e.legato;
    if (!isHP && !isSlideDest) continue;
    const prev = previousOnString(t, e);
    if (!prev) continue;
    const a = dotPosition(v, prev.stringIdx, prev.fret);
    const b = dotPosition(v, e.stringIdx, e.fret);
    ctx.strokeStyle = theme.glyph;
    ctx.fillStyle = theme.glyph;
    ctx.lineWidth = 4;
    const rk = r * dotScale(v, e.stringIdx, e.fret);
    if (isHP) {
      const lift = rk * 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - rk);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - rk - lift, b.x, b.y - rk);
      ctx.stroke();
      ctx.font = font(800, Math.round(rk * 0.9));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(e.tech.includes('hammer') ? 'H' : 'P', (a.x + b.x) / 2, (a.y + b.y) / 2 - rk - lift * 0.55);
    } else {
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Dots for sounding notes
  for (const e of sounding) drawNoteDot(ctx, v, theme, t, e, ms, style, r);
}

function drawNeckNumbers(ctx: Ctx2D, v: NeckView, t: Timeline, th: Theme, ms: number, r0: number): void {
  const horizon = LOOKAHEAD_MS * 2;
  const end = upperBound(t.events, ms + horizon);
  for (let i = upperBound(t.events, ms); i < end; i++) {
    const e = t.events[i]!;
    const p = dotPosition(v, e.stringIdx, e.fret);
    const r = r0 * dotScale(v, e.stringIdx, e.fret);
    const u = 1 - (e.startMs - ms) / horizon; // 0 → 1 as the note approaches
    ctx.globalAlpha = 0.35 + 0.5 * u;
    ctx.fillStyle = th.noteBox;
    circle(ctx, p.x, p.y, r);
    ctx.strokeStyle = th.ghost;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = th.noteText;
    ctx.font = font(800, Math.round(r * 0.95));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e.tech.includes('dead') ? 'x' : String(e.fret), p.x, p.y + 1);
    ctx.globalAlpha = 1;
  }
}

function drawNoteDot(ctx: Ctx2D, v: NeckView, theme: Theme, t: Timeline, e: NoteEvent, ms: number, style: RenderStyle, r0: number): void {
  const r = r0 * dotScale(v, e.stringIdx, e.fret);
  let p = dotPosition(v, e.stringIdx, e.fret);
  // Slide destination: the dot travels from the previous fret.
  if (e.legato && e.tech.includes('slide')) {
    const prev = previousOnString(t, e);
    if (prev) {
      const a = dotPosition(v, prev.stringIdx, prev.fret);
      const u = Math.max(0, Math.min(1, (ms - e.startMs) / Math.min(SLIDE_MS, e.durationMs)));
      p = { x: a.x + (p.x - a.x) * u, y: a.y + (p.y - a.y) * u };
    }
  }
  // Bend: the dot is pushed across the neck as the pitch rises.
  const bend = bendProgress(e, ms);
  if (bend > 0) p = { x: p.x, y: p.y - bend * Math.min(1.5, e.bendSemitones ?? 1) * stringSpacing(v) * (r / r0) * 0.5 };

  ctx.fillStyle = theme.dot;
  ctx.strokeStyle = theme.dot;
  if (e.tech.includes('dead')) {
    ctx.lineWidth = 7;
    const k = r * 0.65;
    ctx.beginPath();
    ctx.moveTo(p.x - k, p.y - k);
    ctx.lineTo(p.x + k, p.y + k);
    ctx.moveTo(p.x + k, p.y - k);
    ctx.lineTo(p.x - k, p.y + k);
    ctx.stroke();
    return;
  }
  if (e.tech.includes('harmonic')) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r * 1.15);
    ctx.lineTo(p.x + r * 1.15, p.y);
    ctx.lineTo(p.x, p.y + r * 1.15);
    ctx.lineTo(p.x - r * 1.15, p.y);
    ctx.closePath();
    ctx.fill();
  } else {
    // Open strings get the same filled dot (labelled 0) so every note of a chord reads as lit.
    circle(ctx, p.x, p.y, r);
    const label = style.fingerNumbers && e.fret > 0 ? (e.finger !== undefined ? String(e.finger) : '') : String(e.fret);
    if (label) {
      ctx.fillStyle = theme.dotText;
      ctx.font = font(700, Math.round(r * 0.95));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x, p.y + 1);
    }
  }

  ctx.fillStyle = theme.glyph;
  ctx.strokeStyle = theme.glyph;
  if (bend > 0 || (e.bendSemitones && ms - e.startMs < 600)) {
    // Bend arrow above the dot with its amount.
    const top = p.y - r - 8;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x + r * 0.2, top);
    ctx.quadraticCurveTo(p.x + r * 1.1, top - 10, p.x + r * 0.9, top - r * 1.4);
    ctx.stroke();
    arrowHead(ctx, p.x + r * 0.9, top - r * 1.4, -Math.PI / 2, 12);
    ctx.font = font(800, 24);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(bendLabel(e.bendSemitones ?? 1), p.x + r * 1.3, top - r * 1.2);
  }
  if (e.tech.includes('vibrato')) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    const x0 = p.x + r + 6;
    const phase = (ms - e.startMs) / 60;
    for (let i = 0; i <= 24; i++) {
      const x = x0 + i * 2.5;
      const y = p.y - 2 * Math.sin(i * 0.9 - phase) * 3;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  if (e.tech.includes('palmMute')) {
    ctx.font = font(800, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('PM', p.x, p.y - r - 4);
  }
  if (style.noteNames) {
    const name = noteName(e.midi);
    ctx.font = font(700, 22);
    const tw = ctx.measureText(name).width + 14;
    // In a chord the space below a dot belongs to the next string: put the name beside it.
    const side = e.chordId !== undefined;
    const bx = side ? p.x + r + 4 : p.x - tw / 2;
    const by = side ? p.y - 14 : p.y + r + 3;
    ctx.fillStyle = 'rgba(13, 15, 20, 0.85)';
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, 28, 8);
    ctx.fill();
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(name, bx + tw / 2, by + 3);
  }
}

export function bendLabel(semitones: number): string {
  if (semitones === 2) return 'full';
  if (semitones === 1) return '½';
  if (semitones === 3) return '1½';
  if (semitones === 4) return '2';
  return `${semitones / 2}`;
}

function arrowHead(ctx: Ctx2D, x: number, y: number, angle: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x + size * Math.cos(angle), y + size * Math.sin(angle));
  ctx.lineTo(x + size * Math.cos(angle + 2.5), y + size * Math.sin(angle + 2.5));
  ctx.lineTo(x + size * Math.cos(angle - 2.5), y + size * Math.sin(angle - 2.5));
  ctx.closePath();
  ctx.fill();
}

function circle(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
