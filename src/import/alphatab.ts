/**
 * The only module that talks to alphaTab's importer + MIDI generator.
 * Timeline building AND synth audio both go through `prepareScore`, so they always share
 * one MidiFile / tick lookup (CLAUDE.md §3 rule 2).
 */
import * as alphaTab from '@coderline/alphatab';

export type Score = alphaTab.model.Score;
export type Track = alphaTab.model.Track;
export type MidiFile = alphaTab.midi.MidiFile;
export type MidiTickLookup = alphaTab.midi.MidiTickLookup;

export class ScoreImportError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ScoreImportError';
  }
}

/** One Settings factory so import, MIDI generation and synthesis never diverge. */
export function createSettings(): alphaTab.Settings {
  const s = new alphaTab.Settings();
  s.core.logLevel = alphaTab.LogLevel.Error;
  return s;
}

/** Parse alphaTex text. Errors carry line/column messages for the editor. */
export function loadAlphaTex(text: string): Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(text, createSettings());
  try {
    return importer.readScore();
  } catch (e) {
    throw new ScoreImportError('Could not read this alphaTex', alphaTexDiagnostics(e));
  }
}

type Diag = { message: string; severity: number; start?: { line: number; col: number } };
type DiagBag = { items?: Diag[] };

function alphaTexDiagnostics(e: unknown): string[] {
  const cause = (e as { cause?: Record<string, DiagBag | undefined> } | null)?.cause;
  if (!cause) return [e instanceof Error ? e.message : String(e)];
  const out: string[] = [];
  for (const key of ['lexerDiagnostics', 'parserDiagnostics', 'semanticDiagnostics']) {
    for (const d of cause[key]?.items ?? []) {
      // severity 2 = error; hints/warnings don't block import
      if (d.severity < 2) continue;
      out.push(d.start ? `Line ${d.start.line}, col ${d.start.col}: ${d.message}` : d.message);
    }
  }
  return out.length > 0 ? out : [e instanceof Error ? e.message : String(e)];
}

export const SCORE_FILE_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.xml', '.musicxml', '.mxl', '.atex', '.alphatex', '.txt'];

/** Guitar Pro 3–7, GPX, MusicXML (binary) — or alphaTex text by extension. */
export function loadScoreFile(bytes: Uint8Array, fileName: string): Score {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.atex') || lower.endsWith('.alphatex') || lower.endsWith('.txt')) {
    return loadAlphaTex(new TextDecoder().decode(bytes));
  }
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, createSettings());
  } catch (e) {
    throw new ScoreImportError(`Could not open ${fileName}. Supported: Guitar Pro 3–7, GPX, MusicXML, alphaTex.`, [
      e instanceof Error ? e.message : String(e),
    ]);
  }
}

/** Tracks we can draw on a fretboard: stringed, non-percussion, 4–8 strings. */
export function playableTracks(score: Score): { index: number; name: string; strings: number }[] {
  return score.tracks
    .filter((t) => !t.isPercussion && t.staves.some((s) => s.isStringed && s.tuning.length >= 4 && s.tuning.length <= 8))
    .map((t) => ({ index: t.index, name: t.name || `Track ${t.index + 1}`, strings: firstStringedStaff(t)!.tuning.length }));
}

export function firstStringedStaff(track: Track): alphaTab.model.Staff | undefined {
  return track.staves.find((s) => s.isStringed && s.tuning.length > 0);
}

export type PreparedScore = {
  score: Score;
  midi: MidiFile;
  tickLookup: MidiTickLookup;
  syncPoints: alphaTab.synth.BackingTrackSyncPoint[];
  transpositionPitches: Map<number, number>;
};

/** Generate the MIDI file + tick lookup exactly once for both timeline and audio. */
export function prepareScore(score: Score): PreparedScore {
  const settings = createSettings();
  const midi = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midi));
  generator.applyTranspositionPitches = false;
  generator.generate();
  return {
    score,
    midi,
    tickLookup: generator.tickLookup,
    syncPoints: generator.syncPoints,
    transpositionPitches: generator.transpositionPitches,
  };
}

export { alphaTab };
