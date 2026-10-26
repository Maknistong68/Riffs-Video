import { useState } from 'react';
import { navigate } from '../../app/router';
import { Segmented } from '../../components/Segmented';
import { tonePreset } from '../../audio/tone';
import { FAMOUS_RIFFS, famousAlphaTex, type FamousRiff } from '../../demo/famous';
import { db, DEFAULT_STYLE, getSettings, type StyleSettings } from '../../storage/db';
import { createRiff } from '../../storage/riffs';

type Level = 'all' | FamousRiff['level'];

const LEVEL_NAME: Record<FamousRiff['level'], string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** The riff's look (colours, tone, drums), composer credit and optional Guess-the-song opener. */
async function famousStyle(r: FamousRiff, guess: boolean): Promise<StyleSettings> {
  const s = await getSettings(db());
  const base = { ...DEFAULT_STYLE, fps: s.defaultFps };
  return {
    ...base,
    render: { ...base.render, theme: r.look.theme, credit: `Music: ${r.composer} · public domain`, opener: guess ? 'guess' : 'none' },
    tone: tonePreset(r.look.tone),
    drums: { pattern: r.look.drums, volume: 0.6 },
  };
}

/** S3: 🎸 Famous riffs — public-domain melodies, checked note by note, straight to the Studio. */
export function FamousScreen() {
  const [level, setLevel] = useState<Level>('all');
  const [guess, setGuess] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const list = FAMOUS_RIFFS.filter((r) => level === 'all' || r.level === level);

  const open = async (r: FamousRiff) => {
    setBusy(r.id);
    try {
      const id = await createRiff({
        title: r.title,
        artist: r.composer,
        isOriginal: false,
        famousId: r.id,
        source: 'alphatex',
        sourceText: famousAlphaTex(r),
        trackIndex: 0,
        // Written and checked in the app (pitches, frets, full bars are unit-tested): no review needed.
        reviewed: true,
        styleSettings: await famousStyle(r, guess),
      });
      navigate({ name: 'studio', riffId: id }, true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="screen no-nav" data-testid="famous">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>Famous riffs</h1>
      </div>
      <p className="dim small">Melodies everyone knows that are in the public domain (classical pieces and traditional songs), so you can post them with the app’s guitar sound. Copyrighted songs aren’t included — for those, open your own Guitar Pro file and use Silent mode.</p>
      <Segmented<Level> label="Level" value={level} onChange={setLevel} options={[{ value: 'all', label: 'All' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
      <label className="switch"><span>Start as “Guess the song?”</span><input type="checkbox" checked={guess} onChange={(e) => setGuess(e.target.checked)} data-testid="famous-guess" /></label>
      <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((r) => (
          <button key={r.id} className="option" onClick={() => void open(r)} disabled={busy !== null} data-testid={`famous-${r.id}`}>
            <span className="ico">{r.look.tone === 'metal' ? '🤘' : r.look.tone === 'nylon' ? '🎼' : '🎸'}</span>
            <span className="txt">
              <strong>{busy === r.id ? 'Opening…' : r.title}</strong>
              <span className="dim small">{r.composer}</span>
              <span className="dim small">{r.hint} · {LEVEL_NAME[r.level]}</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
