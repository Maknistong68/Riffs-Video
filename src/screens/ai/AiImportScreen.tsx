import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { aiConfig, convertTabWithAI, isAnswerFailure, MAX_AI_TEXT_CHARS, type AiFailure } from '../../import/ai';
import { handOffToPaste, takeAiText } from '../../import/pasteHandoff';
import { db, deviceId } from '../../storage/db';
import { createRiff } from '../../storage/riffs';
import { checkAiTabInWorker } from '../../workers/client';
import { firstTitleLine } from '../paste/PasteScreen';

const EXAMPLE = `Intro (play twice)
e|-----------------|-----------------|
B|-----------------|-----------------|
G|-------------5h7-|-7p5-------------|
D|---------5h7-----|-----7-5---------|
A|-----5h7---------|---------7-5-----|
E|-5h8-------------|-------------8-5-|`;

/** S3: AI import — any tab text (messy, with lyrics or chords) → Claude → checked alphaTex → Riff Review. */
export function AiImportScreen() {
  const [text, setText] = useState(takeAiText);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const abort = useRef<AbortController | null>(null);
  const config = aiConfig();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
      abort.current?.abort();
    };
  }, []);

  const convert = async () => {
    setBusy(true);
    setFailure(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const result = await convertTabWithAI({ text, title }, { config, deviceId: await deviceId(db()), online: navigator.onLine, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      // Connection / limit / input problems: nothing to review — say so here and let the user retry.
      if (!result.ok && !isAnswerFailure(result.code)) return setFailure(result);

      const name = title.trim() || (result.ok && result.title) || firstTitleLine(text) || 'AI import';
      const base = { title: name, artist: '', isOriginal: false, source: 'ai' as const };
      let id: string;
      if (result.ok) {
        // Never trust the model's alphaTex unchecked: alphaTab re-parses it, the timeline is validated.
        const check = await checkAiTabInWorker(result.alphaTex, result.notes).catch(() => null);
        id = await createRiff({
          ...base,
          sourceText: result.alphaTex,
          trackIndex: check?.trackIndex ?? 0,
          ...(check?.ok ? { noteConfidence: check.noteConfidence } : {}),
          ai: {
            originalText: text,
            status: check?.ok ? 'ok' : 'failed',
            ...(check?.ok ? {} : { message: 'The AI wrote a tab with mistakes the app can’t read, so nothing was guessed. Fix it below, or try another way.' }),
            errors: check?.errors ?? ['The tab could not be checked.'],
            warnings: [...result.warnings, ...(check?.warnings ?? [])],
            rhythmGuessed: result.rhythmGuessed,
            tempoGuessed: result.tempoGuessed,
            model: result.model,
          },
        });
      } else {
        // The model answered but the answer is unusable: Riff Review explains and offers ways on.
        id = await createRiff({
          ...base,
          sourceText: '',
          trackIndex: 0,
          ai: { originalText: text, status: 'failed', message: result.message, warnings: [], rhythmGuessed: false, tempoGuessed: false },
        });
      }
      navigate({ name: 'review', riffId: id }, true);
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setBusy(false);
    }
  };

  const tooLong = text.length > MAX_AI_TEXT_CHARS;
  const disabled = busy || !config || !online || !text.trim() || tooLong;

  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>AI import</h1>
      </div>
      <p className="dim small">
        Paste a tab as you found it — misaligned columns, lyrics and chord names are fine. It is sent to Claude (Anthropic) through
        RiffReel’s server to be written out; nothing else leaves your phone. You’ll check every note before making a video.
      </p>
      {!config && (
        <div className="notice" data-testid="ai-not-configured">
          AI import isn’t set up in this version of the app. <button className="btn" onClick={() => { handOffToPaste(text); navigate({ name: 'paste' }, true); }}>Use Paste text tab</button>
        </div>
      )}
      {config && !online && <div className="notice" data-testid="ai-offline">You’re offline. AI import needs internet — Paste text tab works offline.</div>}

      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Tab text for AI import"
        data-testid="ai-text"
        style={{ minHeight: 220, whiteSpace: 'pre', overflowX: 'auto' }}
        disabled={busy}
      />
      <div className="row spread small dim">
        <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Open a .txt file</button>
        <span className={tooLong ? 'bad' : ''}>{text.length.toLocaleString('en')} / {MAX_AI_TEXT_CHARS.toLocaleString('en')}</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".txt,text/plain"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void f.text().then(setText);
        }}
      />
      <label className="field">
        <span>Title (optional)</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from the text if empty" disabled={busy} />
      </label>

      {failure && (
        <div className="errors" role="alert" data-testid="ai-error">
          <span>{failure.message}</span>
          {failure.code === 'rate_limited' && failure.retryAfterSec ? <span className="small">Try again in about {Math.ceil(failure.retryAfterSec / 60)} min.</span> : null}
        </div>
      )}

      <div style={{ flex: 1 }} />
      {busy ? (
        <>
          <p className="center" role="status" data-testid="ai-busy">Converting… this can take up to a minute.</p>
          <button className="btn block" onClick={() => abort.current?.abort()}>Cancel</button>
        </>
      ) : (
        <button className="btn primary block" disabled={disabled} onClick={() => void convert()} data-testid="ai-convert">
          {tooLong ? 'Text is too long' : 'Convert with AI'}
        </button>
      )}
    </main>
  );
}
