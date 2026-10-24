/** Large binaries (MP4s): OPFS when writable, else an IndexedDB table (P16). */
import type { RiffReelDb } from './db';

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const probe = await root.getFileHandle('.probe', { create: true });
    if (!('createWritable' in probe)) return null;
    return root;
  } catch {
    return null;
  }
}

let rootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
const getRoot = () => (rootPromise ??= opfsRoot());

export async function saveBlob(db: RiffReelDb, path: string, blob: Blob): Promise<void> {
  const root = await getRoot();
  if (root) {
    const handle = await root.getFileHandle(path, { create: true });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  await db.blobs.put({ path, blob });
}

export async function readBlob(db: RiffReelDb, path: string, type = 'video/mp4'): Promise<Blob | null> {
  const root = await getRoot();
  if (root) {
    try {
      const file = await (await root.getFileHandle(path)).getFile();
      return new Blob([file], { type });
    } catch {
      /* fall through: may have been written before OPFS became available */
    }
  }
  return (await db.blobs.get(path))?.blob ?? null;
}

export async function deleteBlob(db: RiffReelDb, path: string): Promise<void> {
  const root = await getRoot();
  if (root) {
    try {
      await root.removeEntry(path);
    } catch {
      /* not there */
    }
  }
  await db.blobs.delete(path);
}

export type StorageInfo = { usage: number; quota: number; persisted: boolean };

export async function storageInfo(): Promise<StorageInfo> {
  const est = (await navigator.storage?.estimate?.()) ?? {};
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

/** Ask the browser not to evict our files (called on first export). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
