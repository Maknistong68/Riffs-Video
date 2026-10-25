/** Local-only storage (CLAUDE.md §5): Dexie/IndexedDB for records, OPFS for large blobs. */
import Dexie, { type EntityTable } from 'dexie';
import type { SyncReport } from '../export/syncCheck';
import type { Timeline } from '../engine/timeline';
import type { SoundMode } from '../workers/protocol';
import type { RiffEdit } from '../engine/edits';
import { NO_TEACH, type TeachOptions } from '../engine/teach';
import { DEFAULT_STYLE as DEFAULT_RENDER, type RenderStyle } from '../render/style';

export type RiffSourceKind = 'alphatex' | 'gp' | 'ascii' | 'audio' | 'ai';

export type SilentSettings = {
  /** Tempo of the official recording (null = the riff's own tempo). */
  bpm: number | null;
  /** Where in the video the riff's first beat lands (= lead-in), for lining up in TikTok. */
  offsetMs: number;
  /** Local reference recording (OPFS path) — alignment preview only, never exported. */
  refPath?: string;
  refName?: string;
  /** Where the riff's first beat is in the reference recording. */
  refStartMs: number;
};

export type StyleSettings = {
  fps: 30 | 60;
  soundMode: SoundMode;
  leadInMs: number;
  render: RenderStyle;
  teach: TeachOptions;
  silent: SilentSettings;
};

export type RiffRecord = {
  id: string;
  title: string;
  artist: string;
  isOriginal: boolean;
  source: RiffSourceKind;
  sourceText?: string;
  sourceBytes?: Uint8Array;
  fileName?: string;
  trackIndex: number;
  /** Riff Review edits, replayed on the parsed score (audio follows). */
  edits?: RiffEdit[];
  /** The user confirmed the notes in Riff Review (accuracy gate). */
  reviewed?: boolean;
  /** Pasted ASCII tab (source 'ascii'): sourceText is generated from it + the rhythm. */
  asciiText?: string;
  /** How the rhythm was obtained for rhythm-less sources (P1). */
  rhythm?: { method: 'spacing' | 'taps' | 'tempo' | 'audio'; bpm: number; units: number[] };
  /** Per-note confidence 0..1 by note ref key (audio transcription / AI import). */
  noteConfidence?: Record<string, number>;
  /** Original recording (audio import), stored in OPFS — for comparison only, never exported. */
  recordingPath?: string;
  timelineCache?: Timeline;
  styleSettings: StyleSettings;
  demoId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SyncProblem = { text: string; atMs?: number };
export type SyncSummary = Pick<SyncReport, 'ok' | 'matched' | 'total' | 'maxAbsErrorMs' | 'fps' | 'audioChecked'> & { problems: SyncProblem[] };

export type ExportMeta = {
  id: string;
  riffId: string;
  riffTitle: string;
  blobPath: string;
  preset: 'tiktok';
  fps: 30 | 60;
  durationMs: number;
  sizeBytes: number;
  syncReport: SyncSummary;
  /** Silent exports: what to line up in TikTok. */
  silent?: { bpm: number; offsetMs: number };
  createdAt: number;
};

export type AppSettings = {
  id: 'app';
  defaultFps: 30 | 60;
  demosSeeded: boolean;
  persistRequested: boolean;
  copyrightNoticeSeen: boolean;
};

export type StoredBlob = { path: string; blob: Blob };

export class RiffReelDb extends Dexie {
  riffs!: EntityTable<RiffRecord, 'id'>;
  exportsMeta!: EntityTable<ExportMeta, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;
  /** Fallback blob store when OPFS writes are unavailable. */
  blobs!: EntityTable<StoredBlob, 'path'>;

  constructor(name = 'riffreel') {
    super(name);
    this.version(1).stores({
      riffs: 'id, updatedAt, title',
      exportsMeta: 'id, riffId, createdAt',
      settings: 'id',
      blobs: 'path',
    });
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  defaultFps: 30,
  demosSeeded: false,
  persistRequested: false,
  copyrightNoticeSeen: false,
};

export const DEFAULT_SILENT: SilentSettings = { bpm: null, offsetMs: 1000, refStartMs: 0 };
export const DEFAULT_STYLE: StyleSettings = { fps: 30, soundMode: 'synth', leadInMs: 1000, render: DEFAULT_RENDER, teach: NO_TEACH, silent: DEFAULT_SILENT };

/** Records from older versions lack newer fields: fill them with defaults. */
export function styleOf(r: Pick<RiffRecord, 'styleSettings'>): StyleSettings {
  const s = r.styleSettings ?? DEFAULT_STYLE;
  return { ...DEFAULT_STYLE, ...s, render: { ...DEFAULT_RENDER, ...s.render }, teach: { ...NO_TEACH, ...s.teach }, silent: { ...DEFAULT_SILENT, ...s.silent } };
}

export async function getSettings(db: RiffReelDb): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('app')) ?? {}) };
}

export async function updateSettings(db: RiffReelDb, patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
  await db.settings.put({ ...(await getSettings(db)), ...patch, id: 'app' });
}

export function newId(prefix: string): string {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${r[0]!.toString(36)}${r[1]!.toString(36)}`;
}

export function summarise(report: SyncReport): SyncSummary {
  const frameMs = (f: number) => (f * 1000) / report.fps;
  const problems: SyncProblem[] = [
    ...report.matches.filter((m) => !m.ok).map((m) => ({ text: m.detail, atMs: m.expectedMs })),
    ...(report.durations && !report.durations.ok ? [{ text: `audio/video length differ by ${report.durations.diffMs.toFixed(0)} ms` }] : []),
    ...report.frames.filter((f) => !f.ok).map((f) => ({ text: `frame differs from preview (${f.psnr.toFixed(1)} dB)`, atMs: frameMs(f.frame) })),
    ...report.highlights.filter((h) => !h.ok).map((h) => ({ text: `finger dot ${h.detail}`, atMs: frameMs(h.frame) })),
  ];
  if (report.audioChecked === false && report.extras.length) problems.push({ text: 'Silent export contains sound' });
  return { ok: report.ok, matched: report.matched, total: report.total, maxAbsErrorMs: report.maxAbsErrorMs, fps: report.fps, audioChecked: report.audioChecked ?? true, problems };
}

let instance: RiffReelDb | null = null;
export const db = (): RiffReelDb => (instance ??= new RiffReelDb());
