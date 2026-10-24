import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { formatAgo, formatDuration } from '../../components/format';
import { db, type ExportMeta } from '../../storage/db';
import { readBlob } from '../../storage/opfs';

/** S9: rendered videos on this device. */
export function ExportsScreen() {
  const exports = useLiveQuery(() => db().exportsMeta.orderBy('createdAt').reverse().toArray(), []);
  return (
    <main className="screen">
      <div className="topbar"><h1>Exports</h1></div>
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
