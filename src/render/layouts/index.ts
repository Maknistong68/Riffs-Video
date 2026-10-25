/**
 * Layout presets (all 1080×1920, inside the TikTok/Shorts safe zones). Geometry is a pure
 * function of (settings, timeline, ms) — the Close-up camera pans with the hand.
 */
import { upperBound, type Timeline } from '../../engine/timeline';
import type { FrameSettings } from '../drawFrame';
import { SKINS } from '../skins';
import type { NeckView } from '../neck2d';
import type { LaneGeometry } from '../tabLane';

export type LayoutGeometry = {
  neck: NeckView;
  lane: LaneGeometry | null;
  notation: LaneGeometry | null;
  /** Neck-Overlay: upcoming notes are drawn as numbered markers on the neck itself. */
  numbersOnNeck: boolean;
};

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
      const center = cameraCenter(t, ms);
      const from = Math.max(0, Math.min(24 - CLOSEUP_SPAN, center - CLOSEUP_SPAN / 2));
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
