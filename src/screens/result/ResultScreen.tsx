import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { formatBytes, formatDuration } from '../../components/format';
import { db, type ExportMeta } from '../../storage/db';
import { readBlob } from '../../storage/opfs';
import { deleteExport } from '../../storage/riffs';

/** S8: player, Sync Report, share/save. */
export function ResultScreen({ exportId }: { exportId: string }) {
  const meta = useLiveQuery(() => db().exportsMeta.get(exportId), [exportId]);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!meta) return;
    let u: string | null = null;
    void readBlob(db(), meta.blobPath).then((b) => {
      if (!b) return;
      setBlob(b);
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [meta]);

  if (meta === undefined) return <main className="screen no-nav"><p className="dim">Loading…</p></main>;
  if (meta === null) return <main className="screen no-nav"><p>Export not found.</p><a href="#/exports">Back to exports</a></main>;

  const fileName = `${meta.riffTitle.replace(/[^\w\- ]+/g, '').trim() || 'riff'} - RiffReel.mp4`;
  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: 'exports' })}>‹</button>
        <h1>{meta.riffTitle}</h1>
      </div>
      {url ? <video src={url} controls playsInline className="player" data-testid="player" /> : <div className="player" style={{ aspectRatio: '9 / 16' }} />}
      <SyncCard meta={meta} />
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} disabled={!blob} onClick={() => blob && void share(blob, fileName, meta.riffTitle)}>Share</button>
        <button className="btn" style={{ flex: 1 }} disabled={!blob} onClick={() => blob && download(blob, fileName)}>Save</button>
      </div>
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={() => navigate({ name: 'studio', riffId: meta.riffId })}>Edit</button>
        <button className="btn danger" style={{ flex: 1 }} onClick={async () => { await deleteExport(meta.id); navigate({ name: 'exports' }); }}>Delete</button>
      </div>
      <p className="dim small">{formatDuration(meta.durationMs)} · {meta.fps} fps · {formatBytes(meta.sizeBytes)} · 1080×1920</p>
    </main>
  );
}

function SyncCard({ meta }: { meta: ExportMeta }) {
  const s = meta.syncReport;
  return (
    <section className={`card sync ${s.ok ? '' : 'fail'}`} data-testid="sync-report" data-ok={String(s.ok)}>
      <strong>{s.ok ? '✅ In sync' : '⚠️ Sync problems'} — {s.matched}/{s.total} notes matched</strong>
      <p className="dim small">
        Checked by listening to the exported file: every attack within ±1 frame ({(1000 / s.fps).toFixed(1)} ms), every pitch heard,
        frames identical to the preview. Max timing error {s.maxAbsErrorMs.toFixed(1)} ms.
      </p>
      {s.problems.length > 0 && (
        <ul>
          {s.problems.map((p, i) => (
            <li key={i}>
              <span>{p.atMs !== undefined ? `${(p.atMs / 1000).toFixed(2)} s — ` : ''}{p.text}</span>
              {p.atMs !== undefined && (
                <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => navigate({ name: 'studio', riffId: meta.riffId, atMs: p.atMs! })}>
                  Jump to note
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function share(blob: Blob, name: string, title: string) {
  const file = new File([blob], name, { type: 'video/mp4' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  download(blob, name);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
