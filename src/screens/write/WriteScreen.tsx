import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { db } from '../../storage/db';
import { createRiff, updateRiff } from '../../storage/riffs';
import { inspectSource, WorkerError } from '../../workers/client';

const TEMPLATE = `\\title "My Riff"
\\tempo 100
\\track "Guitar"
\\staff {tabs}
\\tuning (E4 B3 G3 D3 A2 E2)
:8 0.6 3.6 0.5 2.5 0.4 2.4 :4 0.3 |
:8 2.3 0.4 2.5{h} 3.5 :2 0.6
`;

/** S3a: alphaTex editor with live validation (fret.string, :duration, | bar line). */
export function WriteScreen({ riffId }: { riffId?: string }) {
  const [text, setText] = useState<string | null>(riffId ? null : TEMPLATE);
  const [status, setStatus] = useState<{ ok: boolean; messages: string[]; title: string }>({ ok: false, messages: [], title: '' });
  const [isOriginal, setIsOriginal] = useState(true);

  useEffect(() => {
    if (!riffId) return;
    void db().riffs.get(riffId).then((r) => {
      setText(r?.sourceText ?? TEMPLATE);
      setIsOriginal(r?.isOriginal ?? true);
    });
  }, [riffId]);

  useEffect(() => {
    if (text === null) return;
    const id = window.setTimeout(() => {
      inspectSource({ kind: 'alphatex', text })
        .then((info) =>
          setStatus(
            info.tracks.length > 0
              ? { ok: true, messages: [], title: info.title }
              : { ok: false, messages: ['Add a guitar track with \\staff {tabs}.'], title: info.title },
          ),
        )
        .catch((e: unknown) => setStatus({ ok: false, messages: e instanceof WorkerError ? e.details.length ? e.details : [e.message] : [String(e)], title: '' }));
    }, 350);
    return () => window.clearTimeout(id);
  }, [text]);

  const save = async () => {
    if (text === null || !status.ok) return;
    const title = status.title || 'Untitled riff';
    if (riffId) {
      await updateRiff(riffId, { sourceText: text, title, isOriginal, timelineCache: undefined });
      navigate({ name: 'studio', riffId }, true);
    } else {
      const id = await createRiff({ title, artist: '', isOriginal, source: 'alphatex', sourceText: text, trackIndex: 0 });
      navigate({ name: 'studio', riffId: id }, true);
    }
  };

  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>{riffId ? 'Edit riff' : 'Write riff'}</h1>
      </div>
      <p className="dim small">
        alphaTex: <code>fret.string</code> (string 1 = high e), <code>:8</code> sets the duration, <code>|</code> ends a bar,{' '}
        <code>(0.6 2.5)</code> is a chord, <code>{'{h}'}</code> hammer/pull, <code>{'{b (0 4)}'}</code> bend, <code>-.2</code> tie.{' '}
        <a href="https://alphatab.net/docs/alphatex/introduction" target="_blank" rel="noreferrer">Reference</a>
      </p>
      <textarea
        className="input"
        value={text ?? ''}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="alphaTex"
        data-testid="alphatex"
      />
      {status.messages.length > 0 && (
        <div className="errors" role="alert" data-testid="tex-errors">
          {status.messages.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}
      <label className="switch card">
        <span>
          <strong>This is my original riff</strong>
          <br />
          <span className="dim small">Synth audio of famous songs can be copyright-claimed.</span>
        </span>
        <input type="checkbox" checked={isOriginal} onChange={(e) => setIsOriginal(e.target.checked)} />
      </label>
      <button className="btn primary block" disabled={!status.ok} onClick={() => void save()} data-testid="save-riff">
        {status.ok ? 'Save & open studio' : 'Fix the errors above'}
      </button>
    </main>
  );
}
