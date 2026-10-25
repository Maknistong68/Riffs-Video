/** One place that turns a riff + its style into the worker's RiffConfig (preview and export agree). */
import { NO_TEACH } from '../engine/teach';
import { OPENER_LEAD_IN_MS, OUTRO_MS } from '../render/overlays';
import type { RiffConfig } from '../workers/protocol';
import { programOf } from '../audio/tone';
import { toneOf, type RiffRecord, type StyleSettings } from './db';
import { riffSource } from './riffs';

/** Lead-in before a hook-first video's first note: enough for one clean frame, no wait. */
export const HOOK_LEAD_IN_MS = 150;

export function riffConfig(riff: RiffRecord, style: StyleSettings): RiffConfig {
  const silent = style.soundMode === 'silent';
  return {
    source: riffSource(riff),
    trackIndex: riff.trackIndex,
    title: riff.title,
    edits: riff.edits ?? [],
    program: programOf(toneOf(style).instrument),
    ...(riff.noteConfidence ? { noteConfidence: riff.noteConfidence } : {}),
    // Silent mode: the official recording sets tempo and where the first beat lands; teach
    // passes would desync from it, so they are off.
    // The opener needs a few seconds before the first note; outro cards need time after the last.
    // Hook first: the riff sounds almost at once (the count-in moves to before the next pass).
    leadInMs: silent
      ? style.silent.offsetMs
      : style.render.opener === 'guess'
        ? Math.max(style.leadInMs, OPENER_LEAD_IN_MS)
        : style.teach.hookFirst
          ? HOOK_LEAD_IN_MS
          : style.leadInMs,
    ...(style.render.heatmap || style.render.opener === 'guess' || style.render.endCard.kind !== 'none' ? { tailMs: OUTRO_MS } : {}),
    teach: silent ? NO_TEACH : style.teach,
    ...(silent && style.silent.bpm ? { tempoBpm: style.silent.bpm } : {}),
  };
}
