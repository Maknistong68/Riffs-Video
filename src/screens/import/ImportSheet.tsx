import { useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { Sheet } from '../../components/Sheet';
import { SCORE_FILE_EXTENSIONS } from '../../import/formats';
import type { RiffSource } from '../../import/source';
import type { TrackInfo } from '../../workers/protocol';
import { inspectSource, WorkerError } from '../../workers/client';
import { createRiff } from '../../storage/riffs';

type Picked = { source: RiffSource; title: string; artist: string; tracks: TrackInfo[] };

/** S3: how to bring a riff in. Phase 1: write alphaTex or open a file. */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);

  const save = async (p: Picked, trackIndex: number) => {
    const isText = p.source.kind === 'alphatex';
    const id = await createRiff({
      title: p.title || 'Untitled riff',
      artist: p.artist,
      isOriginal: false,
      source: isText ? 'alphatex' : 'gp',
      trackIndex,
      ...(p.source.kind === 'alphatex' ? { sourceText: p.source.text } : { sourceBytes: p.source.bytes, fileName: p.source.name }),
    });
    onClose();
    navigate({ name: 'review', riffId: id });
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setErrors([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const lower = file.name.toLowerCase();
      const source: RiffSource =
        lower.endsWith('.atex') || lower.endsWith('.alphatex') || lower.endsWith('.txt')
          ? { kind: 'alphatex', text: new TextDecoder().decode(bytes) }
          : { kind: 'file', name: file.name, bytes };
      const info = await inspectSource(source);
      if (info.tracks.length === 0) throw new WorkerError('This file has no guitar or bass tablature track.', []);
      const p: Picked = { source, title: info.title || file.name.replace(/\.[^.]+$/, ''), artist: info.artist, tracks: info.tracks };
      if (info.tracks.length === 1) await save(p, info.tracks[0]!.index);
      else setPicked(p);
    } catch (e) {
      setErrors(e instanceof WorkerError ? [e.message, ...e.details] : [e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  };

  if (picked) {
    return (
      <Sheet onClose={onClose} label="Choose track">
        <h2>Which track?</h2>
        <p className="dim small">{picked.title} has several tracks. Pick the guitar part to animate.</p>
        {picked.tracks.map((t) => (
          <button key={t.index} className="option" onClick={() => void save(picked, t.index)}>
            <span className="ico">🎸</span>
            <span className="txt"><strong>{t.name}</strong><span className="dim small">{t.strings} strings</span></span>
          </button>
        ))}
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} label="Create riff">
      <h2>New riff</h2>
      <button className="option" onClick={() => { onClose(); navigate({ name: 'famous' }); }} data-testid="open-famous">
        <span className="ico">🎸</span>
        <span className="txt"><strong>Famous riffs</strong><span className="dim small">20 well-known melodies (public domain) — ready to post</span></span>
      </button>
      <button className="option" onClick={() => { onClose(); navigate({ name: 'write' }); }}>
        <span className="ico">✍️</span>
        <span className="txt"><strong>Write riff</strong><span className="dim small">Type tab in alphaTex</span></span>
      </button>
      <button className="option" onClick={() => fileRef.current?.click()} disabled={busy}>
        <span className="ico">📄</span>
        <span className="txt"><strong>{busy ? 'Opening…' : 'Open file'}</strong><span className="dim small">Guitar Pro (.gp .gp5 .gpx .gp3 .gp4), MusicXML, alphaTex</span></span>
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={SCORE_FILE_EXTENSIONS.join(',')}
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
      {errors.length > 0 && (
        <div className="errors" role="alert">
          {errors.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}
      <button className="option" onClick={() => { onClose(); navigate({ name: 'paste' }); }}>
        <span className="ico">📋</span>
        <span className="txt"><strong>Paste text tab</strong><span className="dim small">ASCII tab from anywhere — tap the rhythm after</span></span>
      </button>
      <button className="option" onClick={() => { onClose(); navigate({ name: 'audio' }); }}>
        <span className="ico">🎙️</span>
        <span className="txt"><strong>Record or upload audio</strong><span className="dim small">Play the riff — RiffReel writes the tab</span></span>
      </button>
      <button className="option" onClick={() => { onClose(); navigate({ name: 'ai' }); }}>
        <span className="ico">🤖</span>
        <span className="txt"><strong>AI import</strong><span className="dim small">Messy tab, chords or lyrics sheet — AI writes it out (needs internet)</span></span>
      </button>
      <button className="option" onClick={() => { onClose(); navigate({ name: 'generate' }); }} data-testid="open-generate">
        <span className="ico">🎲</span>
        <span className="txt"><strong>Generate original riff</strong><span className="dim small">Riff of the day, or pick a style — yours to post, no copyright worries</span></span>
      </button>
    </Sheet>
  );
}
