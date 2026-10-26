import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { formatBytes, formatDuration } from '../../components/format';
import { db, styleOf, type ExportMeta, type RiffRecord } from '../../storage/db';
import { buildCaption, type Caption } from '../../engine/caption';
import { seriesText } from '../../render/style';
import { difficultyLabel } from '../../engine/difficulty';
import { copyText, makePracticeLink } from '../../export/practice';
import { readBlob } from '../../storage/opfs';
import { deleteExport, ensureTimelineCache } from '../../storage/riffs';

/** S8: player, Sync Report, share/save. */
export function ResultScreen({ exportId }: { exportId: string }) {
  const meta = useLiveQuery(() => db().exportsMeta.get(exportId), [exportId]);
  const riff = useLiveQuery(async () => (meta ? ((await db().riffs.get(meta.riffId)) ?? null) : undefined), [meta?.riffId]);
  const [link, setLink] = useState<string | null>(null);
  // Riffs made before their timeline was cached: build it once (the caption needs it).
  useEffect(() => {
    if (riff && !riff.timelineCache) void ensureTimelineCache(riff);
  }, [riff]);
  const caption = riff ? captionFor(riff, link) : null;
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
      {meta.silent && (
        <div className="card" data-testid="silent-info">
          <strong>Add the official sound in TikTok</strong>
          <p className="small">Line it up so the riff’s first note plays at <strong>{(meta.silent.offsetMs / 1000).toFixed(2)} s</strong> ({meta.silent.bpm} bpm).</p>
        </div>
      )}
      <SyncCard meta={meta} />
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} disabled={!blob} onClick={() => blob && void share(blob, fileName, caption?.title ?? meta.riffTitle, caption?.full)}>Share</button>
        <button className="btn" style={{ flex: 1 }} disabled={!blob} onClick={() => blob && download(blob, fileName)}>Save</button>
      </div>
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={() => navigate({ name: 'studio', riffId: meta.riffId })}>Edit</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => navigate({ name: 'studio', riffId: meta.riffId, openExport: true })}>Re-export</button>
        <button className="btn danger" style={{ flex: 1 }} onClick={async () => { await deleteExport(meta.id); navigate({ name: 'exports' }); }}>Delete</button>
      </div>
      {riff && caption && <CaptionCard riff={riff} caption={caption} link={link} onLink={setLink} />}
      <p className="dim small">{formatDuration(meta.durationMs)} · {meta.fps} fps · {formatBytes(meta.sizeBytes)} · 1080×1920</p>
    </main>
  );
}

function SyncCard({ meta }: { meta: ExportMeta }) {
  const s = meta.syncReport;
  return (
    <section className={`card sync ${s.ok ? '' : 'fail'}`} data-testid="sync-report" data-ok={String(s.ok)}>
      <strong>{s.ok ? '✅ In sync' : '⚠️ Sync problems'}{s.audioChecked === false ? ' — timing-only (silent)' : ` — ${s.matched}/${s.total} notes matched`}</strong>
      {s.audioChecked === false ? (
        <p className="dim small">Timing-only export: frames identical to the preview, finger dots on their exact frames, sound track silent.</p>
      ) : (
        <p className="dim small">
          Checked by listening to the exported file: every attack within ±1 frame ({(1000 / s.fps).toFixed(1)} ms), every pitch heard,
          frames identical to the preview. Max timing error {s.maxAbsErrorMs.toFixed(1)} ms.
        </p>
      )}
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

function captionFor(riff: RiffRecord, link: string | null): Caption | null {
  const t = riff.timelineCache;
  if (!t) return null;
  const st = styleOf(riff);
  const r = st.render;
  const difficulty = r.difficulty === 'none' ? undefined : r.difficulty === 'auto' ? difficultyLabel(t) : r.difficulty;
  return buildCaption({
    title: riff.title,
    ...(riff.artist ? { artist: riff.artist } : {}),
    ...(r.credit ? { credit: r.credit } : {}),
    timeline: t,
    ...(difficulty ? { difficulty } : {}),
    genre: r.theme,
    isOriginal: riff.isOriginal,
    ...(riff.famousId ? { publicDomain: true } : {}),
    teach: st.teach,
    ...(r.endCard.kind === 'part' ? { part: { part: r.endCard.part ?? 1, parts: r.endCard.parts ?? 2 } } : {}),
    ...(link ? { practiceUrl: link } : {}),
    ...(seriesText(r.series) ? { series: seriesText(r.series) } : {}),
  });
}

/** Auto title / caption / hashtags + practice link, ready to paste into TikTok. */
function CaptionCard({ riff, caption, link, onLink }: { riff: RiffRecord; caption: Caption; link: string | null; onLink: (l: string) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card panel" data-testid="caption-card">
      <h2>Caption</h2>
      <strong>{caption.title}</strong>
      <p className="small" style={{ whiteSpace: 'pre-wrap' }} data-testid="caption-text">{caption.caption}</p>
      <p className="small dim">{caption.hashtags.join(' ')}</p>
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={async () => setMsg(await copyText(caption.full, 'Caption copied'))} data-testid="copy-caption">Copy caption</button>
        <button
          className="btn"
          style={{ flex: 1 }}
          disabled={busy}
          data-testid="make-practice-link"
          onClick={async () => {
            setBusy(true);
            const r = link ? { ok: true as const, url: link } : await makePracticeLink(riff);
            setBusy(false);
            if (!r.ok) return setMsg(r.message);
            onLink(r.url);
            setMsg(await copyText(r.url, 'Practice link copied (also added to the caption)'));
          }}
        >
          {link ? 'Copy practice link' : 'Make practice link'}
        </button>
      </div>
      {msg && <p className="small good" role="status">{msg}</p>}
    </section>
  );
}

async function share(blob: Blob, name: string, title: string, text?: string) {
  const file = new File([blob], name, { type: 'video/mp4' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, ...(text ? { text } : {}) });
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
