/**
 * Batch export queue (phase 6): riffs are exported one after the other with their saved style.
 * The queue lives in IndexedDB, so it survives reloads; an item that was running when the app was
 * closed goes back to "queued" and is resumed when the user starts the queue again (P15).
 */
import { useSyncExternalStore } from 'react';
import { db, newId, styleOf, type QueueItem, type RiffRecord } from '../storage/db';
import { runExport, type ExportRun } from './runExport';

export type QueueProgress = { itemId: string; stage: string; fraction: number } | null;

let running = false;
let stopRequested = false;
let current: ExportRun | null = null;
let progress: QueueProgress = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setProgress = (p: QueueProgress) => {
  progress = p;
  emit();
};

/** Live progress of the item being exported (for the Exports screen). */
export function useQueueProgress(): { running: boolean; progress: QueueProgress } {
  const p = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => progress,
  );
  return { running: running || p !== null, progress: p };
}

/** Riffs must have passed Riff Review (or be demos) — the accuracy gate applies to batches too. */
export function canQueue(r: RiffRecord): boolean {
  return !!(r.reviewed || r.demoId);
}

export async function enqueue(riffs: RiffRecord[]): Promise<number> {
  const ok = riffs.filter(canQueue);
  const now = Date.now();
  await db().exportQueue.bulkAdd(ok.map((r, i) => ({ id: newId('q'), riffId: r.id, riffTitle: r.title, fps: styleOf(r).fps, status: 'queued' as const, createdAt: now + i })));
  return ok.length;
}

/** Items left "running" by a closed app are waiting again. */
export async function recoverQueue(): Promise<void> {
  await db().exportQueue.where('status').equals('running').modify({ status: 'queued' });
}

export async function startQueue(): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  emit();
  let wake: WakeLockSentinel | null = null;
  try {
    wake = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
    for (;;) {
      if (stopRequested) break;
      const next = (await db().exportQueue.where('status').equals('queued').sortBy('createdAt'))[0];
      if (!next) break;
      const riff = await db().riffs.get(next.riffId);
      if (!riff) {
        await db().exportQueue.update(next.id, { status: 'failed', error: 'The riff was deleted.' });
        continue;
      }
      await db().exportQueue.update(next.id, { status: 'running' });
      setProgress({ itemId: next.id, stage: 'prepare', fraction: 0 });
      current = runExport(riff, { fps: next.fps, soundMode: styleOf(riff).soundMode }, (stage, fraction) => setProgress({ itemId: next.id, stage, fraction }));
      try {
        const { exportId, ok } = await current.promise;
        await db().exportQueue.update(next.id, { status: 'done', exportId, syncOk: ok });
      } catch (e) {
        if (stopRequested) await db().exportQueue.update(next.id, { status: 'queued' });
        else await db().exportQueue.update(next.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
      } finally {
        current = null;
      }
    }
  } finally {
    running = false;
    setProgress(null);
    void wake?.release();
  }
}

/** Stops after cancelling the current export (it goes back to the queue). */
export function stopQueue(): void {
  stopRequested = true;
  current?.cancel();
}

export async function removeFromQueue(item: QueueItem): Promise<void> {
  if (item.status === 'running') return;
  await db().exportQueue.delete(item.id);
}

export async function clearFinished(): Promise<void> {
  await db().exportQueue.where('status').anyOf('done', 'failed').delete();
}
