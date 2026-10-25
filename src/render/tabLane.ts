/** Scrolling tab lane with technique glyphs and pick arrows. Pure. */
import { lastNotePerString, type NoteEvent, type Timeline } from '../engine/timeline';
import type { Ctx2D } from './drawFrame';
import { font } from './fonts';
import { noteName } from '../engine/tuning';
import { bendLabel, previousOnString, withAlpha } from './neck2d';
import type { RenderStyle } from './style';
import type { Theme } from './theme';

export type LaneGeometry = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  playheadX: number;
  pxPerMs: number;
};

/** Top padding leaves room for pick strokes, bottom padding for the PM bracket. */
const PAD_TOP = 58;
const PAD_BOTTOM = 52;

export function laneLineY(g: LaneGeometry, stringIdx: number, strings: number): number {
  return g.y0 + PAD_TOP + ((g.y1 - g.y0 - PAD_TOP - PAD_BOTTOM) * stringIdx) / Math.max(1, strings - 1);
}

export function noteX(g: LaneGeometry, e: Pick<NoteEvent, 'startMs'>, ms: number): number {
  return g.playheadX + (e.startMs - ms) * g.pxPerMs;
}

/** Left margin with the string names (e B G D A E). */
const LABEL_W = 58;
const POP_MS = 140;

/** String letters for the margin: high e lower-case, as in printed tab. */
export function stringLetters(tuning: readonly number[]): string[] {
  return tuning.map((m, i) => {
    const n = noteName(m);
    return i === 0 && n === 'E' && tuning.length > 1 ? 'e' : n;
  });
}

export function drawTabLane(ctx: Ctx2D, g: LaneGeometry, t: Timeline, theme: Theme, ms: number, style: RenderStyle): void {
  const strings = t.tuning.length;
  ctx.save();
  // Full-width lane: a faint band instead of a boxed card.
  ctx.fillStyle = withAlpha(theme.laneBg, 0.55);
  ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
  ctx.beginPath();
  ctx.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
  ctx.clip();

  const letters = stringLetters(t.tuning);
  ctx.lineWidth = 2;
  for (let s = 0; s < strings; s++) {
    const y = laneLineY(g, s, strings);
    ctx.strokeStyle = theme.laneLine;
    ctx.beginPath();
    ctx.moveTo(g.x0 + LABEL_W, y);
    ctx.lineTo(g.x1, y);
    ctx.stroke();
    ctx.fillStyle = theme.textDim;
    ctx.font = font(800, 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letters[s] ?? '', g.x0 + LABEL_W / 2, y + 1);
  }
  // Notes fade out as they reach the letters (left) and fade in from the right edge.
  const edgeAlpha = (x: number) => Math.max(0, Math.min(1, (x - (g.x0 + LABEL_W + 10)) / 70, (g.x1 - x) / 60));

  ctx.strokeStyle = theme.textDim;
  for (const b of t.bars) {
    const x = noteX(g, b, ms) - 30;
    if (x < g.x0 + LABEL_W || x > g.x1) continue;
    ctx.globalAlpha = edgeAlpha(x);
    ctx.beginPath();
    ctx.moveTo(x, laneLineY(g, 0, strings));
    ctx.lineTo(x, laneLineY(g, strings - 1, strings));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const visible = t.events.filter((e) => {
    const x = noteX(g, e, ms);
    return x > g.x0 - 160 && x < g.x1 + 80;
  });
  const sounding = new Set(lastNotePerString(t, ms).filter((e): e is NoteEvent => !!e && ms >= e.startMs && ms < e.startMs + e.durationMs));

  // Playhead behind the notes, so the numbers crossing it stay readable: a soft beam + a glowing line.
  const beam = ctx.createLinearGradient(g.playheadX - 40, 0, g.playheadX + 40, 0);
  beam.addColorStop(0, withAlpha(theme.playhead, 0));
  beam.addColorStop(0.5, withAlpha(theme.playhead, 0.16));
  beam.addColorStop(1, withAlpha(theme.playhead, 0));
  ctx.fillStyle = beam;
  ctx.fillRect(g.playheadX - 40, g.y0, 80, g.y1 - g.y0);
  ctx.save();
  ctx.shadowColor = theme.playhead;
  ctx.shadowBlur = 18;
  ctx.fillStyle = theme.playhead;
  ctx.fillRect(g.playheadX - 3, g.y0 + 8, 6, g.y1 - g.y0 - 16);
  ctx.restore();

  // Palm-mute brackets over consecutive PM notes.
  drawPmBrackets(ctx, g, visible, theme, ms);

  // Links between notes: h/p arcs, slide lines.
  ctx.lineWidth = 3;
  for (const e of visible) {
    const hp = e.tech.includes('hammer') ? 'h' : e.tech.includes('pull') ? 'p' : null;
    const slideDest = e.tech.includes('slide') && e.legato;
    if (!hp && !slideDest) continue;
    const prev = previousOnString(t, e);
    if (!prev) continue;
    const y = laneLineY(g, e.stringIdx, strings);
    const xa = noteX(g, prev, ms) + 24;
    const xb = noteX(g, e, ms) - 24;
    const fadeLink = Math.min(edgeAlpha(xa), edgeAlpha(xb));
    if (fadeLink <= 0) continue;
    ctx.globalAlpha = fadeLink;
    ctx.strokeStyle = theme.glyph;
    ctx.fillStyle = theme.glyph;
    if (hp) {
      ctx.beginPath();
      ctx.moveTo(xa, y - 22);
      ctx.quadraticCurveTo((xa + xb) / 2, y - 48, xb, y - 22);
      ctx.stroke();
      ctx.font = font(700, 22);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(hp, (xa + xb) / 2, y - 36);
    } else {
      ctx.beginPath();
      const up = e.fret > prev.fret;
      ctx.moveTo(xa, up ? y + 10 : y - 10);
      ctx.lineTo(xb, up ? y - 10 : y + 10);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The next note(s) to play get a white pill: the eye knows what comes after the playhead.
  const nextStart = visible.find((e) => e.startMs > ms)?.startMs;
  for (const e of visible) {
    const x = noteX(g, e, ms);
    const y = laneLineY(g, e.stringIdx, strings);
    const active = sounding.has(e);
    const fade = edgeAlpha(x);
    if (fade <= 0) continue;
    ctx.globalAlpha = (ms >= e.startMs + e.durationMs ? 0.3 : 1) * fade;
    const label = e.tech.includes('dead') ? 'x' : e.tech.includes('harmonic') ? `<${e.fret}>` : String(e.fret);
    const since = ms - e.startMs;
    const isNext = !active && e.startMs === nextStart;
    const pop = active && since >= 0 && since < POP_MS ? 1 + 0.25 * (1 - since / POP_MS) ** 2 : isNext ? 1.1 : 1;
    const w = Math.max(58, label.length * 24 + 16) * pop;
    const h = 52 * pop;
    ctx.save();
    if (active) {
      ctx.shadowColor = theme.noteBoxActive;
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = active ? theme.noteBoxActive : isNext ? '#f2f2f2' : theme.noteBox;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 12 * pop);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = active ? theme.dotText : isNext ? '#111318' : theme.noteText;
    ctx.font = font(800, Math.round(40 * pop));
    ctx.fillText(label, x, y + 1);
    ctx.fillStyle = theme.glyph;
    if (e.bendSemitones) {
      // Up-arrow + amount, as in printed tab.
      const ax = x + w / 2 + 8;
      ctx.strokeStyle = theme.glyph;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ax, y - 4);
      ctx.quadraticCurveTo(ax + 10, y - 8, ax + 10, y - 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax + 4, y - 22);
      ctx.lineTo(ax + 10, y - 32);
      ctx.lineTo(ax + 16, y - 22);
      ctx.closePath();
      ctx.fill();
      ctx.font = font(700, 20);
      ctx.textAlign = 'left';
      ctx.fillText(bendLabel(e.bendSemitones), ax + 18, y - 28);
      ctx.textAlign = 'center';
    }
    if (e.tech.includes('vibrato')) {
      ctx.font = font(700, 24);
      ctx.textAlign = 'left';
      ctx.fillText('~', x + w / 2 + 2, y + 2);
      ctx.textAlign = 'center';
    }
    if (style.fingerNumbers && e.finger !== undefined) {
      ctx.font = font(600, 18);
      ctx.fillStyle = theme.textDim;
      ctx.fillText(String(e.finger), x + w / 2 - 2, y + 30);
    }
  }
  ctx.globalAlpha = 1;

  // Pick strokes above each note column: ⊓ down, V up.
  if (style.pickArrows) {
    const done = new Set<number>();
    for (const e of visible) {
      if (!e.pick || done.has(Math.round(e.startMs))) continue;
      done.add(Math.round(e.startMs));
      const x = noteX(g, e, ms);
      const y = g.y0 + 12;
      ctx.strokeStyle = theme.glyph;
      ctx.lineWidth = 3;
      ctx.globalAlpha = ms >= e.startMs + e.durationMs ? 0.45 : 1;
      ctx.beginPath();
      if (e.pick === 'down') {
        ctx.moveTo(x - 9, y + 12);
        ctx.lineTo(x - 9, y);
        ctx.lineTo(x + 9, y);
        ctx.lineTo(x + 9, y + 12);
      } else {
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x, y + 14);
        ctx.lineTo(x + 8, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawPmBrackets(ctx: Ctx2D, g: LaneGeometry, visible: NoteEvent[], theme: Theme, ms: number): void {
  const pm = visible.filter((e) => e.tech.includes('palmMute'));
  if (pm.length === 0) return;
  const runs: NoteEvent[][] = [];
  for (const e of pm) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    // Consecutive PM notes (gap < 700 ms) share one bracket.
    if (run && last && e.startMs - last.startMs < 700) run.push(e);
    else runs.push([e]);
  }
  ctx.strokeStyle = theme.glyph;
  ctx.fillStyle = theme.glyph;
  ctx.lineWidth = 3;
  for (const run of runs) {
    const xa = Math.max(g.x0 + 10, noteX(g, run[0]!, ms) - 20);
    const xb = noteX(g, run[run.length - 1]!, ms) + 24;
    const y = g.y1 - 18;
    ctx.font = font(800, 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('PM', xa, y);
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(xa + 36, y);
    ctx.lineTo(xb, y);
    ctx.lineTo(xb, y - 10);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
