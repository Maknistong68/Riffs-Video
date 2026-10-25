import { useMemo, useState } from 'react';
import { navigate } from '../../app/router';
import { tuningLabel } from '../../engine/tuning';
import { AsciiTabError, parseAsciiTab, spacingRhythm, type ParsedAsciiTab } from '../../import/asciiTab';
import { asciiToAlphaTex } from '../../import/asciiToAlphaTex';
import { createRiff } from '../../storage/riffs';

const EXAMPLE = `e|-----------------|-----------------|
B|-----------------|-----------------|
G|-------------5h7-|-7p5-------------|
D|---------5h7-----|-----7-5---------|
A|-----5h7---------|---------7-5-----|
E|-5h8-------------|-------------8-5-|`;

/** S3: paste a text tab → notes (no rhythm yet) → Riff Review, where rhythm is tapped. */
export function PasteScreen() {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [bpm, setBpm] = useState(100);
  const result = useMemo((): { p: ParsedAsciiTab } | { error: string } | null => {
    if (!text.trim()) return null;
    try {
      return { p: parseAsciiTab(text) };
    } catch (e) {
      return { error: e instanceof AsciiTabError ? e.message : String(e) };
    }
  }, [text]);
  const parsed = result && 'p' in result ? result.p : null;
  const notes = parsed?.columns.reduce((n, c) => n + c.notes.length, 0) ?? 0;

  const save = async () => {
    if (!parsed) return;
    const units = spacingRhythm(parsed.columns);
    const name = title.trim() || firstTitleLine(text) || 'Pasted tab';
    const { text: alphaTex } = asciiToAlphaTex(parsed, { title: name, bpm, units });
    const id = await createRiff({
      title: name,
      artist: '',
      isOriginal: false,
      source: 'ascii',
      sourceText: alphaTex,
      asciiText: text,
      rhythm: { method: 'spacing', bpm, units },
      trackIndex: 0,
    });
    navigate({ name: 'review', riffId: id }, true);
  };

  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>Paste text tab</h1>
      </div>
      <p className="dim small">
        Paste the tab exactly as written (one line per string, e.g. <code>e|---0---3---|</code>). RiffReel never fetches tabs from
        websites — paste what you have. Rhythm isn’t in text tabs: you’ll tap it in the next step.
      </p>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Text tab"
        data-testid="ascii"
        style={{ minHeight: 220, whiteSpace: 'pre', overflowX: 'auto' }}
      />
      {!text && (
        <button className="btn" onClick={() => setText(EXAMPLE)}>Try an example</button>
      )}
      {result && 'error' in result && <div className="errors" role="alert">{result.error}</div>}
      {parsed && (
        <div className="card" data-testid="ascii-summary">
          <strong>{notes} notes</strong> in {parsed.columns.length} beats · {parsed.blocks} block{parsed.blocks === 1 ? '' : 's'}
          <p className="small dim">
            {tuningLabel(parsed.tuning, parsed.capo)} ·{' '}
            {parsed.tuningSource === 'labels' ? 'tuning read from the string labels' : parsed.tuningSource === 'text' ? 'tuning read from the text' : 'no labels: assumed standard tuning'}
          </p>
          {parsed.warnings.map((w) => <p key={w} className="small warn">{w}</p>)}
        </div>
      )}
      <label className="field">
        <span>Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={firstTitleLine(text) || 'Pasted tab'} />
      </label>
      <label className="field">
        <span>Tempo guess (BPM) — you can tap it later</span>
        <input className="input" type="number" min={40} max={240} value={bpm} onChange={(e) => setBpm(Math.max(40, Math.min(240, Number(e.target.value) || 100)))} />
      </label>
      <button className="btn primary block" disabled={!parsed} onClick={() => void save()} data-testid="save-ascii">
        {parsed ? 'Continue to review' : 'Paste a tab above'}
      </button>
    </main>
  );
}

/** A plain text line above the tab is usually the song/riff name. */
function firstTitleLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() && !/[-|]{3,}/.test(l) && !/capo|tuning/i.test(l));
  return line?.trim().slice(0, 60) ?? '';
}
