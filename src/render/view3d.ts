/**
 * 3D view of the neck: world model + camera, as pure math (no WebGL). The three.js renderer
 * builds its scene and camera from these numbers, and the 2D overlay (dots, glyphs, fret
 * numbers) plus the Sync Report's pixel probes project through the same function — so a dot
 * always sits exactly on its string, and everything stays a pure function of (timeline, ms, style).
 *
 * World axes: x along the neck (nut at 0, towards the body), y across the strings (string 0 at
 * the top, as on screen), z out of the fretboard towards a front-on viewer.
 */
import type { NeckView, Projector } from './neck2d';

export { CAMERA_PRESETS, clampCamera, DEFAULT_CAMERA, PITCH_MAX, PITCH_MIN, YAW_LIMIT, type Camera3D, type CameraMotion } from './camera';
import { clampCamera, type Camera3D } from './camera';

type Vec3 = [number, number, number];
export type Region = { x: number; y: number; w: number; h: number };

/** Scale length in world units. */
export const SCALE_LENGTH = 10;
const FOV_DEG = 28;
const pos = (f: number) => 1 - 2 ** (-f / 12);

export type NeckModel = {
  strings: number;
  mirror: boolean;
  /** Board width at the window's reference point; the board tapers from nut to body. */
  width: number;
  /** Height of the strings / dots above the board (z). */
  stringZ: number;
  /** World x of a fret wire position. */
  x: (fret: number) => number;
  /** Board width at world x. */
  widthAt: (x: number) => number;
  /** y of a (fractional) string index at world x. */
  stringYAt: (stringIdx: number, x: number) => number;
  /** Distance between neighbouring strings at world x. */
  spacingAt: (x: number) => number;
};

/**
 * The world model for a layout's neck box. The board's proportions match the flat view (so
 * strings are as far apart as in 2D), and do not depend on where the window currently is.
 */
export function neckModel(v: NeckView): NeckModel {
  const span = v.toFret - v.fromFret;
  const ref = v.fromFret <= 0 ? 0 : 3; // panning windows (Close-up) use a fixed reference
  const boxAspect = (v.y1 - v.y0) / Math.max(1, v.x1 - v.x0);
  const width = boxAspect * SCALE_LENGTH * (pos(ref + span) - pos(ref));
  const sign = v.mirror ? -1 : 1;
  const x = (f: number) => sign * pos(f) * SCALE_LENGTH;
  const xBody = pos(24) * SCALE_LENGTH;
  // Taper: 90 % at the nut, 110 % at the 24th fret.
  const widthAt = (wx: number) => width * (0.9 + 0.2 * Math.max(0, Math.min(1.1, Math.abs(wx) / xBody)));
  const pad = 0.09;
  const spacingAt = (wx: number) => (widthAt(wx) * (1 - 2 * pad)) / Math.max(1, v.strings - 1);
  const stringYAt = (s: number, wx: number) => widthAt(wx) * (0.5 - pad) - s * spacingAt(wx);
  return { strings: v.strings, mirror: v.mirror, width, stringZ: width * 0.045, x, widthAt, stringYAt, spacingAt };
}

export type CameraPose = { eye: Vec3; target: Vec3; up: Vec3; fovDeg: number; aspect: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

type Basis = { eye: Vec3; r: Vec3; u: Vec3; f: Vec3; tanHalf: number; aspect: number };

function basis(p: CameraPose): Basis {
  const f = norm(sub(p.target, p.eye));
  const r = norm(cross(f, p.up));
  const u = cross(r, f);
  return { eye: p.eye, r, u, f, tanHalf: Math.tan((p.fovDeg * Math.PI) / 360), aspect: p.aspect };
}

/** Normalised device coordinates (-1..1, y up) and view depth, as three.js PerspectiveCamera does. */
function toNdc(b: Basis, p: Vec3): { x: number; y: number; depth: number } {
  const d = sub(p, b.eye);
  const depth = Math.max(1e-6, dot(d, b.f));
  return { x: dot(d, b.r) / (depth * b.tanHalf * b.aspect), y: dot(d, b.u) / (depth * b.tanHalf), depth };
}

/** Effective camera angles at time ms (slow orbit is a deterministic function of ms). */
export function cameraAngles(c: Camera3D, ms: number): { yaw: number; pitch: number } {
  if (c.motion !== 'orbit') return { yaw: c.yaw, pitch: c.pitch };
  return {
    yaw: c.yaw + 12 * Math.sin((2 * Math.PI * ms) / 9000),
    pitch: c.pitch + 5 * Math.sin((2 * Math.PI * ms) / 13_000),
  };
}

/**
 * Camera that shows the whole fret window (incl. open-string dots and fret numbers) inside the
 * region at the requested angle: the distance and aim are solved so it always fits.
 */
export function solveCamera(m: NeckModel, v: NeckView, region: Region, c: Camera3D, ms: number, fit: Region = region): CameraPose {
  const { yaw, pitch } = cameraAngles(clampCamera(c), ms);
  const yr = (yaw * Math.PI) / 180;
  const pr = (pitch * Math.PI) / 180;
  const dir: Vec3 = [Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
  const aspect = region.w / region.h;
  const from = Math.max(0, v.fromFret) - (v.fromFret <= 0 ? 1.1 : 0.9);
  const xs = [m.x(from), m.x(v.toFret + 0.15)];
  const pts: Vec3[] = [];
  for (const x of xs) {
    const hw = m.widthAt(x) / 2;
    const below = m.stringYAt(m.strings - 1 + 1.7, x); // fret-number row
    for (const y of [hw + m.width * 0.05, below]) for (const z of [-m.width * 0.08, m.stringZ * 2]) pts.push([x, y, z]);
  }
  let target: Vec3 = [(xs[0]! + xs[1]!) / 2, 0, 0];
  let dist = Math.abs(xs[1]! - xs[0]!) * 2;
  const up: Vec3 = [0, 1, 0];
  const margin = 0.94;
  // The window must fit inside `fit` (e.g. left of the TikTok action column); the render covers `region`.
  const fx0 = ((fit.x - region.x) / region.w) * 2 - 1;
  const fx1 = ((fit.x + fit.w - region.x) / region.w) * 2 - 1;
  const fy1 = 1 - ((fit.y - region.y) / region.h) * 2;
  const fy0 = 1 - ((fit.y + fit.h - region.y) / region.h) * 2;
  for (let iter = 0; iter < 8; iter++) {
    const pose: CameraPose = { eye: add(target, mul(dir, dist)), target, up, fovDeg: FOV_DEG, aspect };
    const b = basis(pose);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const n = toNdc(b, p);
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    // Re-aim so what is shown is centred in the fit area, then scale the distance so it fills it.
    const halfH = dist * b.tanHalf;
    const dx = (x0 + x1) / 2 - (fx0 + fx1) / 2;
    const dy = (y0 + y1) / 2 - (fy0 + fy1) / 2;
    target = add(target, add(mul(b.r, dx * halfH * aspect), mul(b.u, dy * halfH)));
    const extent = Math.max((x1 - x0) / (fx1 - fx0), (y1 - y0) / (fy1 - fy0)) / margin;
    dist *= extent;
  }
  return { eye: add(target, mul(dir, dist)), target, up, fovDeg: FOV_DEG, aspect };
}

/** Screen projector for the overlay: (fret, string) → frame pixels + size relative to the flat view. */
export function makeProjector(m: NeckModel, pose: CameraPose, region: Region, flatSpacingPx: number): Projector {
  const b = basis(pose);
  const pxPerUnitAtDepth1 = region.h / 2 / b.tanHalf;
  const screen = (x: number, s: number) => {
    const n = toNdc(b, [x, m.stringYAt(s, x), m.stringZ]);
    return { x: region.x + ((n.x + 1) / 2) * region.w, y: region.y + ((1 - n.y) / 2) * region.h, depth: n.depth };
  };
  return (fret, s) => {
    const x = m.x(fret);
    const p = screen(x, s);
    // Dot size follows the on-screen string spacing (perspective and foreshortening), so
    // neighbouring dots never overlap whatever the angle.
    const q = screen(x, s + 1);
    const onScreen = Math.hypot(q.x - p.x, q.y - p.y);
    const perspective = (m.spacingAt(x) * pxPerUnitAtDepth1) / p.depth;
    const spacingPx = Math.min(perspective, onScreen);
    return {
      x: p.x,
      y: p.y,
      scale: Math.max(0.45, Math.min(1.6, spacingPx / flatSpacingPx)),
    };
  };
}
