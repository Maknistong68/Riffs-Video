/** Local-only storage (CLAUDE.md §5): Dexie/IndexedDB for records, OPFS for large blobs. */
import { toneForSkin, type ToneSettings } from '../audio/tone';
import { DEFAULT_DRUMS, type DrumSettings } from '../audio/drums';
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
  /** The user chose 3D although the benchmark found this device too slow for it. */
  force3d?: boolean;
  /** Instrument + pedals. Unset = the default tone for the chosen guitar model. */
  tone?: ToneSettings;
  /** Drum backing (mixed after the pedals). */
  drums?: DrumSettings;
};

export function drumsOf(s: StyleSettings): DrumSettings {
  return s.drums ?? DEFAULT_DRUMS;
}

/** The tone in effect (explicit choice, or the guitar model's default). */
export function toneOf(s: StyleSettings): ToneSettings {
  return s.tone ?? toneForSkin(s.render.skin);
}

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
  /** AI import (source 'ai'): what the user pasted and how the conversion went. */
  ai?: AiImportInfo;
  /** Original recording (audio import), stored in OPFS — for comparison only, never exported. */
  recordingPath?: string;
  timelineCache?: Timeline;
  styleSettings: StyleSettings;
  demoId?: string;
  createdAt: number;
  updatedAt: number;
};

export type AiImportInfo = {
  /** The text the user pasted (for "try again" / "paste as text tab"). */
  originalText: string;
  /** 'failed': the answer can't be used as-is; Riff Review explains why and offers ways on. */
  status: 'ok' | 'failed';
  message?: string;
  /** alphaTab's complaints about the AI-written tab (line/column), if it didn't parse. */
  errors?: string[];
  warnings: string[];
  rhythmGuessed: boolean;
  tempoGuessed: boolean;
  model?: string;
  /** Phase 6: an original riff the AI wrote from a brief (originalText = the user's idea). */
  generated?: boolean;
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
  /** Anonymous random id for AI-import rate limiting (no account, nothing personal). */
  deviceId?: string;
  /** Measured render+encode speed per view (× real time at 30 fps), from the first-use benchmark. */
  perf?: Partial<Record<'2d' | '3d', { ratio: number; measuredAt: number }>>;
};

export type StoredBlob = { path: string; blob: Blob };

/** Batch export queue (phase 6): riffs waiting to be exported one after the other. */
export type QueueItem = {
  id: string;
  riffId: string;
  riffTitle: string;
  fps: 30 | 60;
  status: 'queued' | 'running' | 'done' | 'failed';
  exportId?: string;
  error?: string;
  syncOk?: boolean;
  createdAt: number;
};

export class RiffReelDb extends Dexie {
  riffs!: EntityTable<RiffRecord, 'id'>;
  exportsMeta!: EntityTable<ExportMeta, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;
  /** Fallback blob store when OPFS writes are unavailable. */
  blobs!: EntityTable<StoredBlob, 'path'>;
  exportQueue!: EntityTable<QueueItem, 'id'>;

  constructor(name = 'riffreel') {
    super(name);
    this.version(1).stores({
      riffs: 'id, updatedAt, title',
      exportsMeta: 'id, riffId, createdAt',
      settings: 'id',
      blobs: 'path',
    });
    this.version(2).stores({ exportQueue: 'id, status, createdAt' });
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

/** The anonymous device id, created on first use. */
export async function deviceId(db: RiffReelDb): Promise<string> {
  const s = await getSettings(db);
  if (s.deviceId) return s.deviceId;
  const id = crypto.randomUUID();
  await updateSettings(db, { deviceId: id });
  return id;
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
