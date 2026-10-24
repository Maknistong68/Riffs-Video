/** Promise API over the render worker. One long-lived worker for inspect/prepare; one per export. */
import type { Exported, ExportStage, Inspected, Prepared, WorkerRequest, WorkerResponse } from './protocol';

export class WorkerError extends Error {
  constructor(message: string, readonly details: string[]) {
    super(message);
  }
}

type Progress = (stage: ExportStage, fraction: number, frame?: number, frames?: number) => void;
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; onProgress?: Progress };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function spawn(): Worker {
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
}

class Channel {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  constructor(readonly worker: Worker) {
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress?.(m.stage, m.fraction, m.frame, m.frames);
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new WorkerError(m.message, m.details));
      else p.resolve(m.result);
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new WorkerError(e.message || 'Worker crashed', []));
      this.pending.clear();
    };
  }
  call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, onProgress?: Progress): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(onProgress ? { onProgress } : {}) });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }
}

let shared: Channel | null = null;
const sharedChannel = () => (shared ??= new Channel(spawn()));

export function inspectSource(source: Extract<WorkerRequest, { type: 'inspect' }>['source']): Promise<Inspected> {
  return sharedChannel().call<Inspected>({ type: 'inspect', source });
}

export function prepareRiff(req: Omit<Extract<WorkerRequest, { type: 'prepare' }>, 'id' | 'type'>): Promise<Prepared> {
  return sharedChannel().call<Prepared>({ type: 'prepare', ...req });
}

export type ExportJob = { promise: Promise<Exported>; cancel: () => void };

export function startExport(req: Omit<Extract<WorkerRequest, { type: 'export' }>, 'id' | 'type'>, onProgress: Progress): ExportJob {
  const channel = new Channel(spawn());
  let cancelled = false;
  const promise = channel.call<Exported>({ type: 'export', ...req }, onProgress).finally(() => channel.worker.terminate());
  return {
    promise: promise.catch((e: unknown) => {
      throw cancelled ? new DOMException('Export cancelled', 'AbortError') : e;
    }),
    cancel: () => {
      cancelled = true;
      channel.worker.terminate();
      // Rejects the pending call so the UI can return to the export sheet.
      channel.worker.dispatchEvent(new ErrorEvent('error', { message: 'Export cancelled' }));
    },
  };
}
