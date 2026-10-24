/** Local-only storage (CLAUDE.md §5): Dexie/IndexedDB for records, OPFS for large blobs. */
import Dexie, { type EntityTable } from 'dexie';
import type { SyncReport } from '../export/syncCheck';
import type { Timeline } from '../engine/timeline';
import type { SoundMode } from '../workers/protocol';

export type RiffSourceKind = 'alphatex' | 'gp' | 'ascii' | 'audio' | 'ai';

export type StyleSettings = {
  fps: 30 | 60;
  soundMode: SoundMode;
  leadInMs: number;
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
  timelineCache?: Timeline;
  styleSettings: StyleSettings;
  demoId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SyncProblem = { text: string; atMs?: number };
export type SyncSummary = Pick<SyncReport, 'ok' | 'matched' | 'total' | 'maxAbsErrorMs' | 'fps'> & { problems: SyncProblem[] };

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

export const DEFAULT_STYLE: StyleSettings = { fps: 30, soundMode: 'synth', leadInMs: 1000 };

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
  return { ok: report.ok, matched: report.matched, total: report.total, maxAbsErrorMs: report.maxAbsErrorMs, fps: report.fps, problems };
}

let instance: RiffReelDb | null = null;
export const db = (): RiffReelDb => (instance ??= new RiffReelDb());
