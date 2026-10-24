/// <reference lib="webworker" />
import type { Timeline } from '../engine/timeline';
import { exportMp4, type ExportInfo } from '../export/exporter';
import type { SyncReport } from '../export/syncCheck';
import { verifyExport } from '../export/verify';

export type RenderRequest = { type: 'export'; timeline: Timeline; fps: 30 | 60 };
export type RenderResponse =
  | { type: 'progress'; stage: 'render' | 'verify'; frame: number; frames: number }
  | { type: 'done'; mp4: ArrayBuffer; info: ExportInfo; report: SyncReport }
  | { type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope;
const post = (m: RenderResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<RenderRequest>) => {
  const req = ev.data;
  try {
    const { data, info } = await exportMp4(req.timeline, { fps: req.fps }, (p) =>
      post({ type: 'progress', stage: 'render', ...p }),
    );
    post({ type: 'progress', stage: 'verify', frame: 0, frames: info.frames });
    const report = await verifyExport(data, req.timeline, req.fps);
    post({ type: 'done', mp4: data, info, report }, [data]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
