import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, getSettings, newId, RiffReelDb, summarise, updateSettings } from '../../src/storage/db';
import { deleteBlob, readBlob, saveBlob } from '../../src/storage/opfs';
import type { SyncReport } from '../../src/export/syncCheck';

describe('db', () => {
  it('stores riffs and settings', async () => {
    const db = new RiffReelDb('t1');
    expect((await getSettings(db)).demosSeeded).toBe(false);
    await updateSettings(db, { demosSeeded: true });
    expect((await getSettings(db)).demosSeeded).toBe(true);
    const id = newId('riff');
    await db.riffs.add({ id, title: 'x', artist: '', isOriginal: true, source: 'alphatex', sourceText: ':4 0.6', trackIndex: 0, styleSettings: DEFAULT_STYLE, createdAt: 1, updatedAt: 1 });
    expect((await db.riffs.get(id))?.sourceText).toBe(':4 0.6');
  });

  it('falls back to IndexedDB blobs without OPFS', async () => {
    const db = new RiffReelDb('t2');
    await saveBlob(db, 'a.mp4', new Blob(['hello']));
    expect(await (await readBlob(db, 'a.mp4'))!.text()).toBe('hello');
    await deleteBlob(db, 'a.mp4');
    expect(await readBlob(db, 'a.mp4')).toBeNull();
  });

  it('summarises a report into readable problems', () => {
    const report = {
      ok: false, fps: 30, toleranceMs: 33.3, matched: 1, total: 2, maxAbsErrorMs: 40, extras: [], frames: [], highlights: [],
      durations: { videoSec: 1, audioSec: 1, diffMs: 0, ok: true },
      matches: [
        { eventId: 'a', expectedMs: 1000, ok: true, detail: 'ok' },
        { eventId: 'b', expectedMs: 1500, ok: false, detail: 'attack late by 40.0 ms' },
      ],
    } as unknown as SyncReport;
    expect(summarise(report).problems).toEqual([{ text: 'attack late by 40.0 ms', atMs: 1500 }]);
  });
});
