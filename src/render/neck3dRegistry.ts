/**
 * The 3D neck renderer is loaded lazily (three.js is large) and registered here, so drawFrame can
 * use it synchronously once ready. Callers (preview, export, Sync Report) await ensureNeck3d()
 * before drawing a 3D frame; drawFrame falls back to the flat neck if it isn't available.
 */
import type { Timeline } from '../engine/timeline';
import type { Ctx2D } from './drawFrame';
import type { View3D } from './layouts';
import type { Skin } from './skins';
import type { Theme } from './theme';

export type NeckRenderer = {
  /** Render the 3D neck for this frame into ctx at view.region. Pure in (view, skin, theme, t, ms). */
  draw(ctx: Ctx2D, view: View3D, skin: Skin, theme: Theme, t: Timeline, ms: number): void;
};

let renderer: NeckRenderer | null = null;
let loading: Promise<boolean> | null = null;

export function neckRenderer(): NeckRenderer | null {
  return renderer;
}

/** Load three.js and create the renderer. Resolves false when WebGL is unavailable. */
export function ensureNeck3d(): Promise<boolean> {
  loading ??= import('./three/neck3d')
    .then((m) => {
      renderer = m.createNeckRenderer();
      return renderer !== null;
    })
    .catch(() => false);
  return loading;
}
