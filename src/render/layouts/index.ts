/**
 * Layout presets (all 1080×1920, inside the TikTok/Shorts safe zones). Geometry is a pure
 * function of (settings, timeline, ms) — the Close-up camera pans with the hand.
 */
import { upperBound, type Timeline } from '../../engine/timeline';
import type { FrameSettings } from '../drawFrame';
import { SKINS } from '../skins';
import { stringSpacing, type NeckView } from '../neck2d';
import { makeProjector, neckModel, solveCamera, type CameraPose, type NeckModel, type Region } from '../view3d';
import type { LaneGeometry } from '../tabLane';

export type LayoutGeometry = {
  neck: NeckView;
  lane: LaneGeometry | null;
  notation: LaneGeometry | null;
  /** Neck-Overlay: upcoming notes are drawn as numbered markers on the neck itself. */
  numbersOnNeck: boolean;
  /** 3D view: the scene the WebGL renderer draws (neck.proj places the overlay on it). */
  view3d?: View3D;
};

export type View3D = { model: NeckModel; pose: CameraPose; region: Region; fromFret: number; toFret: number };

/** Header (title, bpm, badges) ends here; the 3D neck may use the space below it. */
const HEADER_BOTTOM = 300;

/**
 * Layout geometry for this frame, including the 3D camera and projection when the style asks
 * for the 3D view. Pure: the renderer, the overlay and the Sync Report all call this.
 */
export function frameGeometry(s: FrameSettings, t: Timeline, ms: number): LayoutGeometry {
  const geo = layoutGeometry(s, t, ms);
  if (s.style.view !== '3d') return geo;
  const v = geo.neck;
  const h = v.y1 - v.y0;
  const top = Math.max(s.safeZones.topPx + HEADER_BOTTOM, v.y0 - h * 0.9);
  const bottom = Math.min((geo.lane ?? geo.notation)?.y0 ?? s.height - s.safeZones.bottomPx, v.y1 + h * 0.9 + 60) - 8;
  // The guitar may run under the TikTok action column; the notes it must show stay left of it.
  const region: Region = { x: 0, y: Math.round(top), w: s.width, h: Math.round(bottom - top) };
  const fit: Region = { ...region, w: s.width - s.safeZones.rightPx };
  const model = neckModel(v);
  // Follow-hand rig: frame only the frets around the playing hand (the Close-up window, which
  // always contains every sounding note) and pan with it. Other rigs frame the layout's window.
  let fitView = v;
  if (s.style.camera.motion === 'follow' && v.fromFret <= 0) {
    const from = closeupWindow(t, ms);
    fitView = { ...v, fromFret: from, toFret: from + CLOSEUP_SPAN };
  }
  const pose = solveCamera(model, fitView, region, s.style.camera, ms, fit);
  return {
    ...geo,
    neck: { ...v, proj: makeProjector(model, pose, region, stringSpacing(v)), labelFrets: [fitView.fromFret, fitView.toFret] },
    view3d: { model, pose, region, fromFret: fitView.fromFret, toFret: fitView.toFret },
  };
}

/** Visible frets: enough for the highest note in the riff (12, 15, 19 or 24). */
export function visibleFrets(t: Pick<Timeline, 'events'>): number {
  const max = t.events.reduce((m, e) => Math.max(m, e.fret), 0);
  return [12, 15, 19, 24].find((f) => max < f) ?? 24;
}

export const CLOSEUP_SPAN = 6;
const CAMERA_SIGMA_MS = 420;
const CAMERA_LEAD_MS = 150;

/**
 * Close-up camera centre (fret position): Gaussian-weighted mean of nearby fretted notes,
 * centred slightly ahead of now so the camera anticipates the hand. Continuous in ms → smooth.
 */
export function cameraCenter(t: Timeline, ms: number): number {
  const c = ms + CAMERA_LEAD_MS;
  const lo = upperBound(t.events, c - 3 * CAMERA_SIGMA_MS);
  const hi = upperBound(t.events, c + 3 * CAMERA_SIGMA_MS);
  let sw = 0;
  let sx = 0;
  for (let i = lo; i < hi; i++) {
    const e = t.events[i]!;
    if (e.fret === 0) continue;
    const w = Math.exp(-(((e.startMs - c) / CAMERA_SIGMA_MS) ** 2));
    sw += w;
    sx += w * (e.fret - 0.5);
  }
  if (sw > 1e-6) return sx / sw;
  // Nothing nearby: hold on the nearest fretted note (before, else after).
  for (let i = Math.min(lo, t.events.length) - 1; i >= 0; i--) if (t.events[i]!.fret > 0) return t.events[i]!.fret - 0.5;
  for (let i = hi; i < t.events.length; i++) if (t.events[i]!.fret > 0) return t.events[i]!.fret - 0.5;
  return 2.5;
}

/** Notes that must be inside the close-up window: sounding now or starting very soon. */
const MUST_SHOW_AHEAD_MS = 250;

/**
 * Left edge of the close-up window: the smooth camera, nudged just enough that every note
 * sounding now (or about to) is fully in view — a struck note is never off-screen.
 */
export function closeupWindow(t: Timeline, ms: number): number {
  const maxFrom = 24 - CLOSEUP_SPAN;
  let from = Math.max(0, Math.min(maxFrom, cameraCenter(t, ms) - CLOSEUP_SPAN / 2));
  const sounding: number[] = [];
  const upcoming: number[] = [];
  for (let i = upperBound(t.events, ms + MUST_SHOW_AHEAD_MS) - 1; i >= 0; i--) {
    const e = t.events[i]!;
    if (e.startMs < ms - 8000) break; // nothing rings that long
    if (e.fret === 0) continue;
    if (e.startMs > ms) upcoming.push(e.fret);
    else if (ms < e.startMs + e.durationMs) sounding.push(e.fret);
  }
  // Fit upcoming notes only where that doesn't push a sounding note out; sounding notes win.
  const fit = (frets: number[]) => {
    if (!frets.length) return;
    const hi = Math.max(...frets);
    const lo = Math.min(...frets) - 1;
    if (hi > from + CLOSEUP_SPAN) from = hi - CLOSEUP_SPAN;
    if (lo < from) from = lo;
  };
  const inView = (frets: number[], f: number) => frets.every((x) => x - 1 >= f - 1e-9 && x <= f + CLOSEUP_SPAN + 1e-9);
  const before = from;
  fit(upcoming);
  if (!inView(sounding, from)) from = before;
  fit(sounding);
  return Math.max(0, Math.min(maxFrom, from));
}

export function layoutGeometry(s: FrameSettings, t: Timeline, ms: number): LayoutGeometry {
  const right = s.width - s.safeZones.rightPx;
  const bottom = s.height - s.safeZones.bottomPx;
  const strings = t.tuning.length;
  const skin = SKINS[s.style.skin];
  const mirror = s.style.leftHanded;
  // Nut side needs room for open-string dots, the far side for glyphs (vibrato, bend labels).
  const NUT_ROOM = 90;
  const FAR_ROOM = 64;
  const neckBox = (y0: number, height: number, nutRoom = NUT_ROOM) => {
    const h = height * skin.neckScale;
    const mid = y0 + height / 2;
    const x0 = 30 + (mirror ? FAR_ROOM : nutRoom);
    const x1 = right - (mirror ? nutRoom : FAR_ROOM);
    return { x0, x1, y0: mid - h / 2, y1: mid + h / 2 };
  };
  const frets = visibleFrets(t);
  const lane = (y0: number, y1: number): LaneGeometry => ({ x0: 40, x1: right, y0, y1, playheadX: 260, pxPerMs: 0.55 });

  switch (s.style.layout) {
    case 'overlay':
      return {
        neck: { ...neckBox(600, 560), fromFret: 0, toFret: frets, strings, mirror },
        lane: null,
        notation: null,
        numbersOnNeck: true,
      };
    case 'split':
      return {
        neck: { ...neckBox(520, 250), fromFret: 0, toFret: frets, strings, mirror },
        lane: lane(860, 1150),
        notation: lane(1170, bottom - 40),
        numbersOnNeck: false,
      };
    case 'closeup': {
      const from = closeupWindow(t, ms);
      return {
        neck: { ...neckBox(600, 500), fromFret: from, toFret: from + CLOSEUP_SPAN, strings, mirror },
        lane: lane(1190, bottom - 40),
        notation: null,
        numbersOnNeck: false,
      };
    }
    case 'classic':
    default:
      return {
        neck: { ...neckBox(640, 300), fromFret: 0, toFret: frets, strings, mirror },
        lane: lane(1110, bottom - 40),
        notation: null,
        numbersOnNeck: false,
      };
  }
}
