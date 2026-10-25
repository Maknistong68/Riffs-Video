/** 3D camera settings (pure data; part of RenderStyle). */

/** static: fixed angle · orbit: slow deterministic sway · follow: zooms to the playing hand and pans with it. */
export type CameraMotion = 'static' | 'orbit' | 'follow';
/** Camera angles in degrees. yaw turns the neck away (one end recedes), pitch looks from above/below. */
export type Camera3D = { yaw: number; pitch: number; motion: CameraMotion };

export const DEFAULT_CAMERA: Camera3D = { yaw: 24, pitch: 22, motion: 'static' };
export const YAW_LIMIT = 65;
export const PITCH_MIN = -45;
export const PITCH_MAX = 48;

export const CAMERA_PRESETS: { id: string; name: string; yaw: number; pitch: number }[] = [
  { id: 'front', name: 'Front', yaw: 0, pitch: 0 },
  { id: 'angled', name: 'Angled', yaw: 24, pitch: 22 },
  { id: 'low', name: 'Low angle', yaw: 18, pitch: -22 },
  { id: 'high', name: 'From above', yaw: 16, pitch: 42 },
  { id: 'player', name: "Player's view", yaw: 34, pitch: -38 },
  { id: 'side', name: 'Down the neck', yaw: 52, pitch: 14 },
];

export function clampCamera(c: Camera3D): Camera3D {
  return { ...c, yaw: Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, c.yaw)), pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, c.pitch)) };
}
