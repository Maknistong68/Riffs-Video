/** One place that turns a riff + its style into the worker's RiffConfig (preview and export agree). */
import { NO_TEACH } from '../engine/teach';
import type { RiffConfig } from '../workers/protocol';
import type { RiffRecord, StyleSettings } from './db';
import { riffSource } from './riffs';

export function riffConfig(riff: RiffRecord, style: StyleSettings): RiffConfig {
  const silent = style.soundMode === 'silent';
  return {
    source: riffSource(riff),
    trackIndex: riff.trackIndex,
    title: riff.title,
    edits: riff.edits ?? [],
    ...(riff.noteConfidence ? { noteConfidence: riff.noteConfidence } : {}),
    // Silent mode: the official recording sets tempo and where the first beat lands; teach
    // passes would desync from it, so they are off.
    leadInMs: silent ? style.silent.offsetMs : style.leadInMs,
    teach: silent ? NO_TEACH : style.teach,
    ...(silent && style.silent.bpm ? { tempoBpm: style.silent.bpm } : {}),
  };
}
