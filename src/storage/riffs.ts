/** Riff persistence helpers used by screens. */
import { DEMO_RIFFS } from '../demo';
import type { RiffSource } from '../import/source';
import { db, DEFAULT_STYLE, getSettings, newId, updateSettings, type RiffRecord } from './db';
import { deleteBlob } from './opfs';

export function riffSource(r: RiffRecord): RiffSource {
  if (r.sourceBytes && r.fileName) return { kind: 'file', name: r.fileName, bytes: r.sourceBytes };
  return { kind: 'alphatex', text: r.sourceText ?? '' };
}

export async function seedDemos(): Promise<void> {
  const d = db();
  const s = await getSettings(d);
  if (s.demosSeeded) return;
  const now = Date.now();
  await d.riffs.bulkPut(
    DEMO_RIFFS.map((demo, i) => ({
      id: `demo_${demo.id}`,
      title: demo.title,
      artist: 'RiffReel demo',
      isOriginal: true,
      source: 'alphatex' as const,
      sourceText: demo.text,
      trackIndex: 0,
      styleSettings: { ...DEFAULT_STYLE, fps: s.defaultFps },
      demoId: demo.id,
      reviewed: true,
      createdAt: now - i,
      updatedAt: now - i,
    })),
  );
  await updateSettings(d, { demosSeeded: true });
}

export async function createRiff(fields: Omit<RiffRecord, 'id' | 'createdAt' | 'updatedAt' | 'styleSettings'> & Partial<Pick<RiffRecord, 'styleSettings'>>): Promise<string> {
  const id = newId('riff');
  const now = Date.now();
  const s = await getSettings(db());
  await db().riffs.add({ styleSettings: { ...DEFAULT_STYLE, fps: s.defaultFps }, ...fields, id, createdAt: now, updatedAt: now });
  return id;
}

export async function updateRiff(id: string, patch: Partial<Omit<RiffRecord, 'id'>>): Promise<void> {
  await db().riffs.update(id, { ...patch, updatedAt: Date.now() });
}

export async function duplicateRiff(id: string): Promise<string | null> {
  const r = await db().riffs.get(id);
  if (!r) return null;
  const { id: _old, demoId: _demo, createdAt: _c, updatedAt: _u, ...rest } = r;
  return createRiff({ ...rest, title: `${r.title} (copy)` });
}

export async function deleteRiff(id: string): Promise<void> {
  const d = db();
  const exports = await d.exportsMeta.where('riffId').equals(id).toArray();
  for (const e of exports) await deleteBlob(d, e.blobPath);
  const riff = await d.riffs.get(id);
  if (riff?.recordingPath) await deleteBlob(d, riff.recordingPath);
  await d.exportsMeta.where('riffId').equals(id).delete();
  await d.riffs.delete(id);
}

export async function deleteExport(id: string): Promise<void> {
  const d = db();
  const e = await d.exportsMeta.get(id);
  if (e) await deleteBlob(d, e.blobPath);
  await d.exportsMeta.delete(id);
}
