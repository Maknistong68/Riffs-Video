/**
 * Score → alphaTex (practice links): the riff exactly as the user has it — any source (Guitar Pro,
 * MusicXML, text tab, transcription), with Riff Review edits, tuning and capo applied — as text.
 * Only the chosen guitar track is kept. Runs in the worker (alphaTab).
 */
import { applyEdits, type RiffEdit } from '../engine/edits';
import { alphaTab, createSettings } from './alphatab';
import { loadRiffSource, type RiffSource } from './source';

export function riffToAlphaTex(source: RiffSource, trackIndex: number, edits: readonly RiffEdit[], title?: string): string {
  const score = loadRiffSource(source);
  applyEdits(score, trackIndex, edits);
  const track = score.tracks[trackIndex];
  if (!track) throw new Error(`Track ${trackIndex} does not exist`);
  if (title) score.title = title;
  // Keep only the guitar track (Guitar Pro files often carry drums, bass, vocals…).
  score.tracks.length = 0;
  score.tracks.push(track);
  track.index = 0;
  score.finish(createSettings());
  return new alphaTab.exporter.AlphaTexExporter().exportToString(score, createSettings());
}
