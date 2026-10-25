/** Teach options (kept separate from arrange.ts so UI code doesn't bundle alphaTab). */
export type TeachOptions = {
  slowMo: boolean;
  loopHardest: boolean;
  /** Hook-first intro: play it once at full speed before the teach passes. */
  hookFirst?: boolean;
  /** Same riff in 3 positions: the written fingering, then up to two other places on the neck. */
  positions?: boolean;
  /** Speed-up ending: after full speed, 125 % then 150 % ("What BPM can you play it at?"). */
  speedUp?: boolean;
  /** Only these score bars (0-based, inclusive) — for "Part 1 / Part 2" videos. */
  range?: { fromBar: number; toBar: number };
};
export const NO_TEACH: TeachOptions = { slowMo: false, loopHardest: false };
/** New riffs: the riff plays at full speed straight away (the hook), then again — sound in the first second. */
export const DEFAULT_TEACH: TeachOptions = { ...NO_TEACH, hookFirst: true };

/** True when the video is the riff played once, as written (no passes, positions or part range). */
export function isPlainTeach(t: TeachOptions): boolean {
  return !t.slowMo && !t.loopHardest && !t.hookFirst && !t.positions && !t.speedUp && !t.range;
}
