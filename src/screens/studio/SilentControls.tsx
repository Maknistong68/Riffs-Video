import { useRef, useState } from 'react';
import { detectOnsets } from '../../audio/onsets';
import { estimateBpm, tapTempo } from '../../import/rhythm';
import { db, newId, type SilentSettings } from '../../storage/db';
import { deleteBlob, saveBlob } from '../../storage/opfs';

/**
 * Silent / timing-only (P18, P7): tempo + first-beat offset so the official sound can be added
 * in TikTok. A local reference recording helps line things up in the preview — it is never exported.
 */
export function SilentControls({
  silent,
  riffBpm,
  reference,
  onChange,
}: {
  silent: SilentSettings;
  riffBpm: number;
  reference: AudioBuffer | null;
  onChange: (s: SilentSettings) => void;
}) {
  const taps = useRef<number[]>([]);
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bpm = silent.bpm ?? riffBpm;
  const refDur = reference?.duration ?? 0;

  const loadReference = async (f: File) => {
    const d = db();
    if (silent.refPath) await deleteBlob(d, silent.refPath);
    const path = `ref_${newId('r')}`;
    await saveBlob(d, path, f);
    onChange({ ...silent, refPath: path, refName: f.name, refStartMs: 0 });
  };

  const detect = () => {
    if (!reference) return;
    setDetecting(true);
    // 20 s from the chosen start, mono; flux onsets → tempo vote.
    setTimeout(() => {
      const sr = reference.sampleRate;
      const from = Math.floor((silent.refStartMs / 1000) * sr);
      const len = Math.min(reference.length - from, 20 * sr);
      const mono = new Float32Array(Math.max(0, len));
      for (let c = 0; c < reference.numberOfChannels; c++) {
        const ch = reference.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i]! += ch[from + i]! / reference.numberOfChannels;
      }
      const est = estimateBpm(detectOnsets(mono, sr));
      if (est) onChange({ ...silent, bpm: est });
      setDetecting(false);
    }, 30);
  };

  return (
    <div className="panel" data-testid="silent-controls">
      <p className="small dim">
        The video gets no audible sound. In TikTok, pick the official sound and line it up: first note at{' '}
        <strong>{(silent.offsetMs / 1000).toFixed(2)} s</strong>, <strong>{bpm} bpm</strong>.
      </p>
      <div className="row spread">
        <span>Tempo</span>
        <div className="row">
          <input
            className="input"
            style={{ width: 96 }}
            type="number"
            step={0.25}
            min={40}
            max={240}
            value={bpm}
            aria-label="Tempo (bpm)"
            onChange={(e) => onChange({ ...silent, bpm: Math.max(40, Math.min(240, Number(e.target.value) || riffBpm)) })}
          />
          <button
            className="btn"
            onPointerDown={(e) => {
              const t = e.timeStamp;
              taps.current = [...taps.current.filter((x) => t - x < 3000), t];
              const b = tapTempo(taps.current);
              setTapBpm(b);
              if (b) onChange({ ...silent, bpm: b });
            }}
          >
            Tap{tapBpm ? ` (${tapBpm})` : ''}
          </button>
        </div>
      </div>
      <div className="row spread">
        <span>First note at</span>
        <div className="row">
          <button className="btn" aria-label="Earlier" onClick={() => onChange({ ...silent, offsetMs: Math.max(0, silent.offsetMs - 100) })}>−</button>
          <strong style={{ minWidth: 64, textAlign: 'center' }}>{(silent.offsetMs / 1000).toFixed(1)} s</strong>
          <button className="btn" aria-label="Later" onClick={() => onChange({ ...silent, offsetMs: Math.min(10_000, silent.offsetMs + 100) })}>+</button>
        </div>
      </div>

      <div className="field">
        <span>Reference recording (preview only — never in the video)</span>
        <button className="btn" onClick={() => fileRef.current?.click()}>{silent.refName ? `Replace: ${silent.refName}` : 'Load the song from this phone'}</button>
        <input ref={fileRef} type="file" hidden accept="audio/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadReference(f); }} />
      </div>
      {reference && (
        <>
          <label className="field">
            <span>The riff’s first note is at {(silent.refStartMs / 1000).toFixed(2)} s in the song</span>
            <input type="range" min={0} max={Math.max(0, refDur * 1000)} step={10} value={silent.refStartMs} onChange={(e) => onChange({ ...silent, refStartMs: Number(e.target.value) })} aria-label="Song position" />
          </label>
          <div className="row">
            {[-100, -10, 10, 100].map((d) => (
              <button key={d} className="btn" style={{ flex: 1, minHeight: 40 }} onClick={() => onChange({ ...silent, refStartMs: Math.max(0, silent.refStartMs + d) })}>
                {d > 0 ? '+' : '−'}{Math.abs(d)} ms
              </button>
            ))}
          </div>
          <button className="btn" onClick={detect} disabled={detecting}>{detecting ? 'Listening…' : 'Detect tempo from the song'}</button>
          <p className="small dim">Press play: the song plays under the visuals. Nudge until the dots land on the notes.</p>
        </>
      )}
    </div>
  );
}
