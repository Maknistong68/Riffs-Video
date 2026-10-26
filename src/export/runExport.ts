/**
 * Export one riff and store the result (shared by the Export sheet and the batch queue):
 * worker render + encode + Sync Report → MP4 in OPFS + metadata in IndexedDB.
 */
import { soundPackById } from '../audio/soundpacks';
import { db, drumsOf, getSettings, newId, styleOf, summarise, toneOf, updateSettings, type RiffRecord } from '../storage/db';
import { requestPersistence, saveBlob } from '../storage/opfs';
import { riffConfig } from '../storage/riffConfig';
import { riffSource } from '../storage/riffs';
import { startExport } from '../workers/client';
import type { ExportStage, SoundMode } from '../workers/protocol';

export type ExportProgress = (stage: ExportStage, fraction: number, frame?: number, frames?: number) => void;
export type ExportRun = { promise: Promise<{ exportId: string; ok: boolean }>; cancel: () => void };

export function runExport(riff: RiffRecord, opts: { fps: 30 | 60; soundMode: SoundMode }, onProgress: ExportProgress): ExportRun {
  const style = styleOf(riff);
  const job = startExport(
    {
      riff: { ...riffConfig(riff, { ...style, soundMode: opts.soundMode }), source: riffSource(riff) },
      fps: opts.fps,
      style: style.render,
      soundMode: opts.soundMode,
      tone: toneOf(style),
      drums: drumsOf(style),
      soundFontUrl: soundPackById(style.soundPack).url,
      modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, location.href).href,
    },
    onProgress,
  );
  const promise = job.promise.then(async (r) => {
    const d = db();
    const id = newId('exp');
    const blobPath = `${id}.mp4`;
    await saveBlob(d, blobPath, new Blob([r.mp4], { type: 'video/mp4' }));
    await d.exportsMeta.add({
      id,
      riffId: riff.id,
      riffTitle: riff.title,
      blobPath,
      preset: 'tiktok',
      fps: opts.fps,
      durationMs: r.timeline.durationMs,
      sizeBytes: r.info.sizeBytes,
      syncReport: summarise(r.report),
      ...(opts.soundMode === 'silent' ? { silent: { bpm: Math.round((r.timeline.tempoMap[0]?.bpm ?? 0) * 4) / 4, offsetMs: r.timeline.leadInMs } } : {}),
      createdAt: Date.now(),
    });
    // P16: ask the browser not to evict our files, once, at the first export.
    const s = await getSettings(d);
    const series = styleOf(riff).render.series;
    if (series?.on) await updateSettings(d, { nextSeriesNumber: Math.max(s.nextSeriesNumber ?? 1, Math.round(series.number) + 1) });
    if (!s.persistRequested) {
      await requestPersistence();
      await updateSettings(d, { persistRequested: true });
    }
    return { exportId: id, ok: r.report.ok };
  });
  return { promise, cancel: job.cancel };
}
