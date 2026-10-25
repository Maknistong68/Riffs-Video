import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { formatAgo, formatDuration } from '../../components/format';
import { db, type ExportMeta, type QueueItem } from '../../storage/db';
import { clearFinished, removeFromQueue, startQueue, stopQueue, useQueueProgress } from '../../export/queue';
import { readBlob } from '../../storage/opfs';

/** S9: rendered videos on this device. */
export function ExportsScreen() {
  const exports = useLiveQuery(() => db().exportsMeta.orderBy('createdAt').reverse().toArray(), []);
  return (
    <main className="screen">
      <div className="topbar"><h1>Exports</h1></div>
      <QueuePanel />
      {exports && exports.length === 0 && <div className="empty"><p>No videos yet. Open a riff and tap Export.</p></div>}
      <div className="grid">
        {exports?.map((e) => <ExportTile key={e.id} meta={e} />)}
      </div>
    </main>
  );
}

function ExportTile({ meta }: { meta: ExportMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void readBlob(db(), meta.blobPath).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [meta.blobPath]);
  return (
    <button className="export-tile" onClick={() => navigate({ name: 'result', exportId: meta.id })}>
      {url ? <video src={`${url}#t=1.2`} muted playsInline preload="metadata" /> : <div style={{ aspectRatio: '9 / 16', background: '#000' }} />}
      <span className="meta">
        <strong className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.riffTitle}</strong>
        <span className={`badge ${meta.syncReport.ok ? 'good' : 'bad'}`}>{meta.syncReport.ok ? '✓ In sync' : '⚠ Check sync'}</span>
        <span className="dim small">{formatDuration(meta.durationMs)} · {meta.fps} fps · {formatAgo(meta.createdAt)}</span>
      </span>
    </button>
  );
}

const STAGE_LABEL: Record<string, string> = { prepare: 'Preparing', audio: 'Sound', render: 'Rendering', 'verify-audio': 'Checking sync', 'verify-pitch': 'Checking sync', 'verify-frames': 'Checking sync' };

/** Batch export queue: one riff after the other, with their saved style. */
function QueuePanel() {
  const items = useLiveQuery(() => db().exportQueue.orderBy('createdAt').toArray(), []);
  const { running, progress } = useQueueProgress();
  if (!items || items.length === 0) return null;
  const waiting = items.filter((i) => i.status === 'queued').length;
  const finished = items.filter((i) => i.status === 'done' || i.status === 'failed').length;
  return (
    <section className="card panel" data-testid="export-queue">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Export queue</h2>
        <span className="dim small">{waiting} waiting</span>
      </div>
      {items.map((it: QueueItem) => (
        <div key={it.id} className="row spread queue-item" data-testid="queue-item" data-status={it.status}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.riffTitle}</strong>
            <span className={`small ${it.status === 'failed' ? 'bad' : 'dim'}`}>
              {it.status === 'queued' && 'Waiting'}
              {it.status === 'running' && (progress?.itemId === it.id ? `${STAGE_LABEL[progress.stage] ?? progress.stage} · ${Math.round(progress.fraction * 100)}%` : 'Starting…')}
              {it.status === 'done' && (it.syncOk ? '✓ Done · in sync' : '⚠ Done · check sync')}
              {it.status === 'failed' && `Failed: ${it.error ?? 'unknown error'}`}
            </span>
          </span>
          {it.status === 'done' && it.exportId ? (
            <button className="btn" onClick={() => navigate({ name: 'result', exportId: it.exportId! })}>Open</button>
          ) : it.status !== 'running' ? (
            <button className="btn ghost" aria-label={`Remove ${it.riffTitle} from the queue`} onClick={() => void removeFromQueue(it)}>✕</button>
          ) : null}
        </div>
      ))}
      <div className="row">
        {running ? (
          <button className="btn block" onClick={stopQueue} data-testid="queue-stop">Stop after cancelling this one</button>
        ) : (
          <button className="btn primary block" disabled={waiting === 0} onClick={() => void startQueue()} data-testid="queue-start">Export {waiting} video{waiting === 1 ? '' : 's'}</button>
        )}
        {finished > 0 && !running && <button className="btn ghost" onClick={() => void clearFinished()}>Clear finished</button>}
      </div>
      {running && <p className="dim small">Keep RiffReel open and the screen on until the queue is done.</p>}
    </section>
  );
}
