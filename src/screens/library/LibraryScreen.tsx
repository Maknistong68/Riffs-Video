import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../../app/haptics';
import { navigate } from '../../app/router';
import { formatAgo, formatDuration } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Thumbnail } from '../../components/Thumbnail';
import { tuningLabel } from '../../engine/tuning';
import { db, type RiffRecord } from '../../storage/db';
import { deleteRiff, duplicateRiff, riffSource, updateRiff } from '../../storage/riffs';
import { buildRiffTimeline } from '../../workers/client';

type Sort = 'recent' | 'title';

export function LibraryScreen({ onCreate }: { onCreate: () => void }) {
  const riffs = useLiveQuery(() => db().riffs.toArray(), []);
  const exports = useLiveQuery(() => db().exportsMeta.toArray(), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [menu, setMenu] = useState<RiffRecord | null>(null);

  // Fill in timelines (thumbnail, tuning, length) for riffs never opened in the studio.
  useEffect(() => {
    const missing = (riffs ?? []).filter((r) => !r.timelineCache);
    let live = true;
    void (async () => {
      for (const r of missing) {
        if (!live) return;
        try {
          const timeline = await buildRiffTimeline({ source: riffSource(r), trackIndex: r.trackIndex, leadInMs: r.styleSettings.leadInMs, title: r.title });
          await db().riffs.update(r.id, { timelineCache: timeline });
        } catch {
          /* broken source: shown without thumbnail; the studio explains the error */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [riffs?.map((r) => r.id + (r.timelineCache ? '1' : '0')).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastExport = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of exports ?? []) m.set(e.riffId, Math.max(m.get(e.riffId) ?? 0, e.createdAt));
    return m;
  }, [exports]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (riffs ?? []).filter((r) => !q || r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q));
    return list.sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));
  }, [riffs, query, sort]);

  return (
    <main className="screen">
      <div className="topbar">
        <h1>Library</h1>
      </div>
      <input className="search" type="search" placeholder="Search riffs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search riffs" />
      <Segmented<Sort> label="Sort" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'title', label: 'A–Z' }]} />
      {riffs && shown.length === 0 && (
        <div className="empty">
          <p>{query ? 'No riffs match.' : 'No riffs yet.'}</p>
          <button className="btn primary" onClick={onCreate}>Create a riff</button>
        </div>
      )}
      <div className="list">
        {shown.map((r) => (
          <RiffCard key={r.id} riff={r} lastExport={lastExport.get(r.id)} onMenu={() => setMenu(r)} />
        ))}
      </div>
      {menu && <RiffMenu riff={menu} onClose={() => setMenu(null)} />}
    </main>
  );
}

function RiffCard({ riff, lastExport, onMenu }: { riff: RiffRecord; lastExport: number | undefined; onMenu: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const t = riff.timelineCache;
  const start = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      haptic(20);
      onMenu();
    }, 500);
  };
  const cancel = () => window.clearTimeout(timer.current);
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="riff-card"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu();
        }}
        onClick={() => {
          if (!longPressed.current) navigate(riff.reviewed || riff.demoId ? { name: 'studio', riffId: riff.id } : { name: 'review', riffId: riff.id });
        }}
      >
        <Thumbnail timeline={t} />
        <span className="meta">
          <span className="title">{riff.title}</span>
          <span className="dim small">{t ? `${tuningLabel(t.tuning, t.capo)} · ${formatDuration(t.durationMs)}` : riff.artist || ' '}</span>
          <span className="dim small">{lastExport ? `Exported ${formatAgo(lastExport)}` : 'Not exported yet'}</span>
          {riff.demoId ? <span className="badge">Demo · original</span> : !riff.reviewed && <span className="badge bad">Needs review</span>}
        </span>
      </button>
      <button className="icon-btn" style={{ position: 'absolute', right: 4, top: 4 }} aria-label={`More actions for ${riff.title}`} onClick={onMenu}>
        ⋯
      </button>
    </div>
  );
}

function RiffMenu({ riff, onClose }: { riff: RiffRecord; onClose: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(riff.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Sheet onClose={onClose} label="Riff actions">
      <h2>{riff.title}</h2>
      {renaming ? (
        <form
          className="field"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim()) await updateRiff(riff.id, { title: name.trim() });
            onClose();
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="New name" />
          <button className="btn primary" type="submit">Save name</button>
        </form>
      ) : confirmDelete ? (
        <>
          <p>Delete “{riff.title}” and its exported videos? This cannot be undone.</p>
          <button className="btn danger block" onClick={async () => { await deleteRiff(riff.id); onClose(); }}>Delete</button>
          <button className="btn block" onClick={() => setConfirmDelete(false)}>Keep it</button>
        </>
      ) : (
        <>
          <button className="option" onClick={() => setRenaming(true)}><span className="ico">✏️</span><span className="txt"><strong>Rename</strong></span></button>
          <button className="option" onClick={async () => { await duplicateRiff(riff.id); onClose(); }}><span className="ico">📄</span><span className="txt"><strong>Duplicate</strong></span></button>
          {riff.source === 'alphatex' && (
            <button className="option" onClick={() => navigate({ name: 'write', riffId: riff.id })}><span className="ico">⌨️</span><span className="txt"><strong>Edit alphaTex</strong></span></button>
          )}
          <button className="option" onClick={() => setConfirmDelete(true)}><span className="ico">🗑️</span><span className="txt"><strong className="bad">Delete</strong></span></button>
        </>
      )}
    </Sheet>
  );
}
