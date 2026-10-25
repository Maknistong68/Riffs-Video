/** One place that turns a riff + its style into the worker's RiffConfig (preview and export agree). */
import { NO_TEACH } from '../engine/teach';
import { OPENER_LEAD_IN_MS, OUTRO_MS } from '../render/overlays';
import type { RiffConfig } from '../workers/protocol';
import { programOf } from '../audio/tone';
import { toneOf, type RiffRecord, type StyleSettings } from './db';
import { riffSource } from './riffs';

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
    leadInMs: silent ? style.silent.offsetMs : Math.max(style.leadInMs, style.render.opener === 'guess' ? OPENER_LEAD_IN_MS : 0),
    ...(style.render.heatmap || style.render.opener === 'guess' || style.render.endCard.kind !== 'none' ? { tailMs: OUTRO_MS } : {}),
    teach: silent ? NO_TEACH : style.teach,
    ...(silent && style.silent.bpm ? { tempoBpm: style.silent.bpm } : {}),
  };
}
