/**
 * Phase 6 video overlays, all pure functions of (timeline, ms, style):
 * bar counter, "Guess the song" opener + reveal, end-of-video fretboard heatmap, Part / Follow end
 * cards. Their timing comes from the timeline (lead-in before the first note, outro after the last).
 */
import { difficultyLabel, type DifficultyLabel } from '../engine/difficulty';
import type { Timeline } from '../engine/timeline';
import type { Ctx2D, FrameSettings } from './drawFrame';
import { font } from './fonts';
import type { LayoutGeometry } from './layouts';
import { dotPosition, dotRadius, dotScale } from './neck2d';
import type { EndCard } from './style';
import { roundRect } from './tabLane';

type Line = { text: string; size: number; weight: 500 | 600 | 700 | 800; dim?: boolean };

/** Lead-in / tail the riff needs for the opener and the outro (riffConfig applies them). */
export const OPENER_LEAD_IN_MS = 3200;
export const OUTRO_MS = 3200;
const OUTRO_GAP_MS = 250;

type Span = { firstMs: number; lastEndMs: number; maxBar: number; difficulty: DifficultyLabel };
const spans = new WeakMap<Timeline, Span>();

/** First note, end of the last note, highest bar number (cached per timeline: frames call this a lot). */
export function musicSpan(t: Timeline): Span {
  let s = spans.get(t);
  if (!s) {
    const first = t.events[0]?.startMs ?? t.leadInMs;
    const last = t.events.reduce((m, e) => Math.max(m, e.startMs + e.durationMs), first);
    // Difficulty of the riff as written: the "Full speed" pass when the video has passes (a 150 %
    // speed-up pass would otherwise make every riff "Hard").
    const full = t.sections?.find((x) => x.label === 'Full speed');
    const rated = full ? { ...t, events: t.events.filter((e) => e.startMs >= full.startMs && e.startMs < full.endMs) } : t;
    s = { firstMs: first, lastEndMs: last, maxBar: t.bars.reduce((m, b) => Math.max(m, b.index), 0), difficulty: difficultyLabel(rated) };
    spans.set(t, s);
  }
  return s;
}

export const inOutro = (t: Timeline, ms: number) => ms >= musicSpan(t).lastEndMs + OUTRO_GAP_MS;
const fadeIn = (ms: number, from: number, len = 400) => Math.max(0, Math.min(1, (ms - from) / len));

export function autoDifficulty(t: Timeline): DifficultyLabel {
  return musicSpan(t).difficulty;
}

/** "Bar 3 / 8" while the music plays (shown in the header's subtitle line), else null. */
export function barCounterText(t: Timeline, ms: number): string | null {
  const span = musicSpan(t);
  if (ms < span.firstMs - 50 || ms > span.lastEndMs) return null;
  let bar: Timeline['bars'][number] | undefined;
  for (const b of t.bars) {
    if (b.startMs <= ms + 0.5) bar = b;
    else break;
  }
  return bar ? `Bar ${bar.index + 1} / ${span.maxBar + 1}` : null;
}

/** Centre of the area below the neck (tab lane / notation), where opener and end cards go. */
function cardArea(geo: LayoutGeometry, s: FrameSettings): { x: number; y: number; w: number; h: number } {
  const right = s.width - s.safeZones.rightPx;
  const top = geo.lane?.y0 ?? geo.notation?.y0 ?? Math.min(s.height - s.safeZones.bottomPx - 360, geo.neck.y1 + 140);
  const bottom = s.height - s.safeZones.bottomPx - 60;
  return { x: 40, y: top, w: right - 40, h: Math.max(240, bottom - top) };
}

function card(ctx: Ctx2D, s: FrameSettings, a: { x: number; y: number; w: number; h: number }, alpha: number, lines: Line[]): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = s.theme.laneBg;
  roundRect(ctx, a.x, a.y, a.w, a.h, 28);
  ctx.fill();
  const total = lines.reduce((h, l) => h + l.size * 1.3, 0);
  let y = a.y + (a.h - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.font = font(l.weight, l.size);
    ctx.fillStyle = l.dim ? s.theme.textDim : s.theme.text;
    ctx.fillText(l.text, a.x + a.w / 2, y, a.w - 60);
    y += l.size * 1.3;
  }
  ctx.restore();
}

/** "Guess the song?" over the tab lane during the lead-in, with a 3-2-1 countdown to the first note. */
export function drawOpener(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, ms: number): void {
  if (s.style.opener !== 'guess') return;
  const first = musicSpan(t).firstMs;
  if (ms >= first) return;
  const left = (first - ms) / 1000;
  const alpha = Math.min(1, left / 0.25);
  card(ctx, s, cardArea(geo, s), alpha, [
    { text: 'Guess the song?', size: 72, weight: 800 },
    { text: 'Comment your answer', size: 34, weight: 600, dim: true },
    { text: String(Math.min(3, Math.ceil(left))), size: 120, weight: 800 },
  ]);
}

function endCardLines(e: EndCard): Line[] {
  if (e.kind === 'part') {
    const part = Math.max(1, e.part ?? 1);
    const parts = Math.max(part, e.parts ?? 2);
    const next = e.text || (part < parts ? `Part ${part + 1} on my profile` : 'That’s the whole riff!');
    return [{ text: `Part ${part} of ${parts}`, size: 64, weight: 800 }, { text: next, size: 38, weight: 600, dim: true }];
  }
  if (e.kind === 'follow') return [{ text: e.text || 'Follow for more riffs', size: 56, weight: 800 }];
  return [];
}

/** After the last note: heatmap on the neck, then the reveal (Guess mode) and the end card. */
export function drawOutro(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, ms: number): void {
  if (!inOutro(t, ms)) return;
  const start = musicSpan(t).lastEndMs + OUTRO_GAP_MS;
  const a = fadeIn(ms, start);
  if (s.style.heatmap) drawHeatmap(ctx, t, s, geo, a);
  const reveal: Line[] =
    s.style.opener === 'guess'
      ? [{ text: 'It was…', size: 34, weight: 600, dim: true }, { text: t.title, size: 64, weight: 800 }, ...(s.style.credit ? [{ text: s.style.credit, size: 32, weight: 500, dim: true } as Line] : [])]
      : [];
  const lines: Line[] = [...reveal, ...endCardLines(s.style.endCard)];
  if (lines.length) card(ctx, s, cardArea(geo, s), a, lines);
}

/** Where the riff lives on the neck: one glow per string/fret, brighter and bigger the more it is played. */
export function drawHeatmap(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, alpha: number): void {
  const counts = new Map<string, { stringIdx: number; fret: number; n: number }>();
  for (const e of t.events) {
    if (e.tech.includes('tieContinue')) continue;
    const k = `${e.stringIdx}:${e.fret}`;
    const c = counts.get(k) ?? { stringIdx: e.stringIdx, fret: e.fret, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const max = Math.max(1, ...[...counts.values()].map((c) => c.n));
  const v = geo.neck;
  const r0 = dotRadius(v);
  ctx.save();
  if (geo.view3d) {
    const r = geo.view3d.region;
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }
  for (const c of [...counts.values()].sort((x, y) => x.n - y.n)) {
    if (c.fret > 0 && (c.fret < v.fromFret || c.fret - 1 > v.toFret)) continue;
    const p = dotPosition(v, c.stringIdx, c.fret);
    const k = c.n / max;
    const r = r0 * dotScale(v, c.stringIdx, c.fret) * (0.75 + 0.55 * k);
    ctx.globalAlpha = alpha * (0.35 + 0.6 * k);
    ctx.fillStyle = s.theme.dot;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.theme.dotText;
    ctx.font = font(800, Math.round(r * 0.8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${c.n}×`, p.x, p.y + 1);
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = s.theme.text;
  ctx.font = font(800, 40);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Every note of this riff', 60, (geo.view3d?.region.y ?? v.y0 - 60) + 44);
  ctx.restore();
}
