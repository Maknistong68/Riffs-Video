import { frameToMs } from '../engine/time';
import { tuningLabel } from '../engine/tuning';
import { activeEvents, upperBound, type Timeline } from '../engine/timeline';
import { font } from './fonts';
import { frameGeometry, HEADER, type LayoutGeometry } from './layouts';
import { neckRenderer } from './neck3dRegistry';
import { autoDifficulty, drawOpener, drawOutro, inOutro } from './overlays';
import { drawNeck, withAlpha } from './neck2d';
import { drawNotation } from './notation';
import { SKINS } from './skins';
import { DEFAULT_STYLE, type RenderStyle } from './style';
import { drawTabLane, roundRect, stringLetters } from './tabLane';
import { SAFE_ZONES, THEMES, type Theme } from './theme';

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
  const st = { ...DEFAULT_STYLE, ...style };
  return {
    fps,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    theme: THEMES[st.theme] ?? THEMES.dark,
    safeZones: SAFE_ZONES,
    showSafeZones: false,
    style: st,
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
  let geo = frameGeometry(s, t, ms);
  const r3d = geo.view3d ? neckRenderer() : null;
  // 3D requested but the renderer isn't loaded (or WebGL is missing): draw the flat neck.
  if (geo.view3d && !r3d) geo = frameGeometry({ ...s, style: { ...s.style, view: '2d' } }, t, ms);
  const right = s.width - s.safeZones.rightPx;

  ctx.save();
  if (th.backgroundTop && th.backgroundBottom) {
    const g = ctx.createLinearGradient(0, 0, 0, s.height);
    g.addColorStop(0, th.backgroundTop);
    g.addColorStop(1, th.backgroundBottom);
    ctx.fillStyle = g;
  } else ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, s.width, s.height);
  drawStage(ctx, t, s, geo, ms);

  drawHeader(ctx, t, s, ms);
  drawSection(ctx, t, s, ms);

  if (geo.view3d && r3d) {
    r3d.draw(ctx, geo.view3d, SKINS[s.style.skin], th, t, ms);
    // Fade the guitar out before TikTok's action column (x ≥ width − rightPx).
    const fx = s.width - s.safeZones.rightPx - 60;
    const fade = ctx.createLinearGradient(fx, 0, s.width, 0);
    fade.addColorStop(0, withAlpha(th.backgroundTop ?? th.background, 0));
    fade.addColorStop(1, withAlpha(th.backgroundTop ?? th.background, 0.9));
    ctx.fillStyle = fade;
    ctx.fillRect(fx, geo.view3d.region.y, s.width - fx, geo.view3d.region.h);
    // Dots/glyphs of frets the camera doesn't show must not spill over the header or tab lane.
    const r = geo.view3d.region;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    drawNeck(ctx, geo.neck, SKINS[s.style.skin], th, t, ms, s.style, geo.numbersOnNeck);
    ctx.restore();
  } else {
    drawNeck(ctx, geo.neck, SKINS[s.style.skin], th, t, ms, s.style, geo.numbersOnNeck);
  }
  const outro = inOutro(t, ms) && (s.style.opener === 'guess' || s.style.endCard.kind !== 'none');
  const opening = s.style.opener === 'guess' && ms < (t.events[0]?.startMs ?? 0);
  // Opener / end cards take the tab lane's place while they show.
  if (!outro && !opening) {
    if (geo.lane) drawTabLane(ctx, geo.lane, t, th, ms, s.style);
    if (geo.notation) drawNotation(ctx, geo.notation, t, th, ms);
  }
  if (!geo.lane && !geo.notation && !outro && !opening) drawReadout(ctx, t, s, geo, ms);
  drawCountIn(ctx, t, s, geo, ms);
  drawOpener(ctx, t, s, geo, ms);
  drawOutro(ctx, t, s, geo, ms);

  // Progress bar (above the caption safe zone) + watermark
  const barY = s.height - s.safeZones.bottomPx - 16;
  ctx.fillStyle = th.laneLine;
  roundRect(ctx, 40, barY, right - 40, 8, 4);
  ctx.fill();
  // Bar ticks on the progress bar (replaces a "Bar 3 / 8" chip).
  if (s.style.barCounter) {
    ctx.fillStyle = withAlpha(th.text, 0.35);
    for (const b of t.bars.slice(1)) ctx.fillRect(40 + ((right - 40) * b.startMs) / t.durationMs - 1.5, barY - 6, 3, 20);
  }
  const done = (right - 40) * Math.min(1, ms / t.durationMs);
  if (done > 1) {
    ctx.save();
    ctx.shadowColor = th.playhead;
    ctx.shadowBlur = 12;
    ctx.fillStyle = th.playhead;
    roundRect(ctx, 40, barY, Math.max(8, done), 8, 4);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = withAlpha(th.text, 0.45);
  ctx.font = font(700, 26);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s.style.credit ? `RiffReel · ${s.style.credit}` : 'RiffReel', right, barY - 14);

  if (s.showSafeZones) {
    ctx.fillStyle = 'rgba(255, 60, 60, 0.25)';
    ctx.fillRect(s.width - s.safeZones.rightPx, 0, s.safeZones.rightPx, s.height);
    ctx.fillRect(0, s.height - s.safeZones.bottomPx, s.width, s.safeZones.bottomPx);
    ctx.fillRect(0, 0, s.width, s.safeZones.topPx);
  }
  ctx.restore();
}

/**
 * Light behind the neck in the theme's accent, pulsing on every attack, plus a vignette that
 * pulls the eye to the middle. Pure function of time like everything else.
 */
function drawStage(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, ms: number): void {
  const th = s.theme;
  const v = geo.neck;
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  const last = t.events[upperBound(t.events, ms) - 1];
  const pulse = last && !last.legato ? 0.08 * Math.exp(-(ms - last.startMs) / 160) : 0;
  const glow = ctx.createRadialGradient(cx, cy, 40, cx, cy, 680);
  glow.addColorStop(0, withAlpha(th.dot, 0.14 + pulse));
  glow.addColorStop(1, withAlpha(th.dot, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s.width, s.height);
  const vig = ctx.createRadialGradient(s.width / 2, s.height * 0.45, s.width * 0.45, s.width / 2, s.height * 0.45, s.height * 0.75);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, s.width, s.height);
}

/** The hook shows full size this long; the comment prompt replaces it for the last END_PROMPT_MS. */
const HOOK_FULL_MS = 2500;
const END_PROMPT_MS = 1200;

/** Count-in over the neck before the first note: "3 · 2 · 1", one per beat, pulsing. */
function drawCountIn(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, ms: number): void {
  const first = t.events[0];
  if (!first || ms >= first.startMs) return;
  // The lead-in is split into three equal steps so it always reads 3 · 2 · 1.
  const step = first.startMs / 3;
  if (step < 120) return;
  const left = first.startMs - ms;
  const n = Math.min(3, Math.ceil(left / step));
  const into = step * n - left; // ms since this number appeared
  const v = geo.neck;
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  ctx.save();
  ctx.font = font(800, Math.round(300 * (1 + 0.25 * Math.max(0, 1 - into / 200))));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.35;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(String(n), cx, cy);
  ctx.fillStyle = s.theme.text;
  ctx.fillText(String(n), cx, cy);
  ctx.restore();
}

/** Neck-Overlay has no tab lane: a big "e string · fret 8" readout for the note being played. */
function drawReadout(ctx: Ctx2D, t: Timeline, s: FrameSettings, geo: LayoutGeometry, ms: number): void {
  const now = activeEvents(t, ms);
  if (!now.length) return;
  const th = s.theme;
  const letters = stringLetters(t.tuning);
  const latest = Math.max(...now.map((e) => e.startMs));
  const hit = now.filter((e) => e.startMs === latest);
  const y = Math.min(s.height - s.safeZones.bottomPx - 110, geo.neck.y1 + 190);
  const x = 56;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (hit.length === 1) {
    const e = hit[0]!;
    const name = letters[e.stringIdx] ?? '';
    ctx.font = font(800, 72);
    ctx.fillStyle = th.dot;
    ctx.fillText(`${name} string`, x, y);
    const w = ctx.measureText(`${name} string`).width;
    ctx.fillStyle = th.text;
    ctx.fillText(e.tech.includes('dead') ? ' · muted' : ` · fret ${e.fret}`, x + w, y);
  } else {
    ctx.font = font(800, 72);
    ctx.fillStyle = th.dot;
    ctx.fillText(`Chord · ${hit.length} strings`, x, y);
  }
  ctx.restore();
}

/** Largest font size (≤ max) at which `text` fits in `maxW`. */
function fitFont(ctx: Ctx2D, text: string, weight: 500 | 600 | 700 | 800, max: number, min: number, maxW: number): number {
  ctx.font = font(weight, max);
  const w = ctx.measureText(text).width;
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / w));
}

function drawHeader(ctx: Ctx2D, t: Timeline, s: FrameSettings, ms: number): void {
  const th = s.theme;
  const top = s.safeZones.topPx;
  const x = 56;
  const maxW = s.width - s.safeZones.rightPx - x - 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Guess mode keeps the title secret until the reveal.
  const hidden = s.style.opener === 'guess' && !inOutro(t, ms);
  // Last stretch: a comment prompt takes the hook's place (comments push the video).
  const ending = !hidden && s.style.hook.trim() !== '' && ms > t.durationMs - END_PROMPT_MS && s.style.endCard.kind === 'none';
  const hook = hidden ? 'Guess the song?' : ending ? 'What BPM can you play it at?' : s.style.hook.trim();
  if (hook) {
    // The hook: big, heavy, outlined so it reads over anything — visible from the first frame, then
    // it steps back (84 → 52 px over 300 ms) once the riff has the viewer's attention.
    const k = hidden || ending ? 0 : Math.max(0, Math.min(1, (ms - HOOK_FULL_MS) / 300));
    const size = Math.round(fitFont(ctx, hook, 800, 84, 52, maxW) * (1 - k) + Math.min(60, fitFont(ctx, hook, 800, 84, 40, maxW)) * k);
    ctx.font = font(800, size);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(hook, x, top + HEADER.hookBaseline);
    ctx.fillStyle = th.text;
    ctx.fillText(hook, x, top + HEADER.hookBaseline);
    if (!hidden) {
      // The riff name steps back with the hook (46 → 40 px, 70 % opacity) so the hook stays on top.
      const titleSize = fitFont(ctx, t.title, 800, Math.round(46 - 6 * k), 28, maxW);
      ctx.font = font(800, titleSize);
      ctx.globalAlpha = 1 - 0.3 * k;
      ctx.fillStyle = th.dot;
      ctx.fillText(t.title, x, top + HEADER.titleBaseline - Math.round(14 * k));
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.font = font(800, fitFont(ctx, t.title, 800, 76, 46, maxW));
    ctx.fillStyle = th.text;
    ctx.fillText(t.title, x, top + HEADER.titleBaseline - 20);
  }

  // Chips: tempo, bar, tuning (only when not standard), difficulty, credit.
  const chips: { text: string; fill: string; ink: string }[] = [];
  const plain = { fill: 'rgba(255, 255, 255, 0.09)', ink: th.text };
  chips.push({ text: `${Math.round(currentBpm(t, ms))} BPM`, ...plain });
  const tuning = tuningLabel(t.tuning, t.capo);
  if (tuning !== 'Standard tuning') chips.push({ text: tuning, ...plain });
  if (s.style.difficulty !== 'none') {
    const label = s.style.difficulty === 'auto' ? autoDifficulty(t) : s.style.difficulty;
    chips.push({ text: label, fill: withAlpha(th.dot, 0.2), ink: th.dot });
  }
  if (s.style.credit && !hidden) chips.push({ text: s.style.credit, fill: 'rgba(255, 255, 255, 0)', ink: th.textDim });
  let cx = x;
  const cy = top + HEADER.chipsCenter;
  ctx.font = font(700, 28);
  ctx.textBaseline = 'middle';
  for (const c of chips) {
    const w = ctx.measureText(c.text).width + 36;
    if (cx + w > x + maxW) break;
    ctx.fillStyle = c.fill;
    roundRect(ctx, cx, cy - 24, w, 48, 24);
    ctx.fill();
    ctx.fillStyle = c.ink;
    ctx.fillText(c.text, cx + 18, cy + 1);
    cx += w + 12;
  }
  ctx.textBaseline = 'alphabetic';
}

/** Teach captions: "Slow · 50%", "Loop 2/3 · bar 3", "Full speed". */
function drawSection(ctx: Ctx2D, t: Timeline, s: FrameSettings, ms: number): void {
  const sec = t.sections?.find((x) => ms >= x.startMs - 400 && ms < x.endMs + 400);
  if (!sec) return;
  const th = s.theme;
  ctx.font = font(800, 34);
  const w = ctx.measureText(sec.label).width + 56;
  const x = 56;
  const y = s.safeZones.topPx + HEADER.sectionCenter;
  ctx.save();
  ctx.shadowColor = th.noteBoxActive;
  ctx.shadowBlur = 20;
  ctx.fillStyle = th.noteBoxActive;
  roundRect(ctx, x, y - 28, w, 56, 28);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = th.dotText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sec.label, x + w / 2, y + 1);
}
