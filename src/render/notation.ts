/**
 * Standard notation strip for the Split layout: treble clef 8vb (guitar sounds an octave below
 * written), scrolling with the tab lane. Note values are derived from duration vs tempo, so
 * this is a reading aid, not an engraver.
 */
import type { NoteEvent, Timeline } from '../engine/timeline';
import type { Ctx2D } from './drawFrame';
import { MUSIC_FONT } from './fonts';
import { noteX, type LaneGeometry } from './tabLane';
import type { Theme } from './theme';

const G = {
  clef8vb: '',
  whole: '',
  half: '',
  black: '',
  sharp: '',
};
// Letter index (C=0 … B=6) and sharp flag per pitch class.
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
/** Diatonic step of E4 (bottom line of the treble staff). */
const BOTTOM_LINE_STEP = 4 * 7 + 2;

/** Written diatonic step for a sounding MIDI pitch (guitar: written an octave higher). */
export function staffStep(midi: number): { step: number; sharp: boolean } {
  const written = midi + 12;
  const pc = ((written % 12) + 12) % 12;
  const octave = Math.floor(written / 12) - 1;
  return { step: octave * 7 + LETTER[pc]!, sharp: SHARP[pc]! };
}

function bpmAt(t: Timeline, ms: number): number {
  let bpm = t.tempoMap[0]?.bpm ?? 120;
  for (const x of t.tempoMap) if (x.ms <= ms) bpm = x.bpm;
  return bpm;
}

export function drawNotation(ctx: Ctx2D, g: LaneGeometry, t: Timeline, theme: Theme, ms: number): void {
  const sp = 20; // staff space
  const bottom = (g.y0 + g.y1) / 2 + 2 * sp;
  const lineY = (step: number) => bottom - ((step - BOTTOM_LINE_STEP) * sp) / 2;

  ctx.save();
  ctx.fillStyle = theme.laneBg;
  ctx.beginPath();
  ctx.roundRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, 24);
  ctx.fill();
  ctx.clip();

  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(g.x0, bottom - i * sp);
    ctx.lineTo(g.x1, bottom - i * sp);
    ctx.stroke();
  }
  ctx.fillStyle = theme.text;
  ctx.font = `${sp * 4}px "${MUSIC_FONT}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(G.clef8vb, g.x0 + 14, lineY(BOTTOM_LINE_STEP + 2));

  ctx.strokeStyle = theme.textDim;
  for (const b of t.bars) {
    const x = noteX(g, b, ms) - 30;
    if (x < g.x0 + 90 || x > g.x1) continue;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom - 4 * sp);
    ctx.stroke();
  }

  // Group simultaneous notes into chords.
  const groups: NoteEvent[][] = [];
  for (const e of t.events) {
    const x = noteX(g, e, ms);
    if (x < g.x0 + 90 || x > g.x1 + 40) continue;
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0]!.startMs - e.startMs) < 1) last.push(e);
    else groups.push([e]);
  }
  for (const chord of groups) {
    const e0 = chord[0]!;
    const x = noteX(g, e0, ms);
    const past = ms >= e0.startMs + e0.durationMs;
    const active = ms >= e0.startMs && !past;
    ctx.globalAlpha = past ? 0.45 : 1;
    const beats = e0.durationMs / (60_000 / bpmAt(t, e0.startMs));
    const head = beats >= 3.5 ? G.whole : beats >= 1.75 ? G.half : G.black;
    const color = active ? theme.noteBoxActive : theme.text;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const steps = chord.map((e) => ({ e, ...staffStep(e.midi) }));
    for (const s of steps) {
      const y = lineY(s.step);
      // Ledger lines
      ctx.lineWidth = 2;
      for (let l = BOTTOM_LINE_STEP - 2; l >= s.step; l -= 2) hLine(ctx, x - 16, x + 16, lineY(l));
      for (let l = BOTTOM_LINE_STEP + 10; l <= s.step; l += 2) hLine(ctx, x - 16, x + 16, lineY(l));
      ctx.font = `${sp * 4}px "${MUSIC_FONT}"`;
      ctx.textAlign = 'center';
      ctx.fillText(head, x, y);
      if (s.sharp) ctx.fillText(G.sharp, x - 26, y);
    }
    if (head !== G.whole) {
      const lo = Math.min(...steps.map((s) => s.step));
      const hi = Math.max(...steps.map((s) => s.step));
      const up = (lo + hi) / 2 < BOTTOM_LINE_STEP + 4;
      ctx.lineWidth = 2.5;
      const sx = up ? x + 10.5 : x - 10.5;
      ctx.beginPath();
      ctx.moveTo(sx, up ? lineY(lo) : lineY(hi));
      ctx.lineTo(sx, up ? lineY(hi) - 3.5 * sp : lineY(lo) + 3.5 * sp);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.fillStyle = theme.playhead;
  ctx.fillRect(g.playheadX - 3, g.y0 + 8, 6, g.y1 - g.y0 - 16);
}

function hLine(ctx: Ctx2D, x0: number, x1: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
}
