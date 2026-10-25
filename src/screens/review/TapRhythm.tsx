import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../app/haptics';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import type { AsciiColumn } from '../../import/asciiTab';
import { quantizeOnsets, tapTempo, type Quantized } from '../../import/rhythm';

type Mode = 'notes' | 'beat';

const VALUE_NAMES: Record<number, string> = { 1: '1/16', 2: '1/8', 3: '1/8.', 4: '1/4', 6: '1/4.', 8: '1/2', 12: '1/2.', 16: '1' };

/** P1: give a text tab its rhythm by tapping each note (or just the beat for the tempo). */
export function TapRhythm({
  columns,
  bpm,
  onApply,
  onClose,
}: {
  columns: AsciiColumn[];
  bpm: number;
  onApply: (r: { units: number[] | null; bpm: number; method: 'taps' | 'tempo' }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('notes');
  const [taps, setTaps] = useState<number[]>([]);
  const [result, setResult] = useState<Quantized | null>(null);
  const tapsRef = useRef<number[]>([]);
  const total = columns.length;

  const reset = () => {
    tapsRef.current = [];
    setTaps([]);
    setResult(null);
  };
  useEffect(reset, [mode]);

  const tap = (t: number) => {
    if (result) return;
    haptic(8);
    const next = [...tapsRef.current, t];
    tapsRef.current = next;
    setTaps(next);
    if (mode === 'notes' && next.length === total) setResult(quantizeOnsets(next, { preferBpm: bpm }));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        tap(e.timeStamp);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const beatBpm = mode === 'beat' ? tapTempo(taps) : null;
  const nextCol = columns[taps.length];
  const label = nextCol ? nextCol.notes.map((n) => (n.dead ? 'x' : n.fret)).join(' + ') : '✓';

  return (
    <Sheet onClose={onClose} label="Tap the rhythm">
      <h2>Tap the rhythm</h2>
      <Segmented<Mode> label="Tap mode" value={mode} onChange={setMode} options={[{ value: 'notes', label: 'Tap each note' }, { value: 'beat', label: 'Tap the beat' }]} />
      <p className="dim small">
        {mode === 'notes'
          ? `Tap once per note, in time, as if you were playing it (${total} notes). Spacebar works too.`
          : 'Tap along with the beat (4+ taps) to set the tempo; note lengths stay as guessed from the spacing.'}
      </p>
      <button
        className="tap-pad"
        data-testid="tap-pad"
        onPointerDown={(e) => {
          e.preventDefault();
          tap(e.timeStamp);
        }}
        aria-label="Tap"
      >
        <span className="tap-count">{mode === 'notes' ? `${taps.length} / ${total}` : `${taps.length} taps`}</span>
        <span className="tap-next">{mode === 'notes' ? (result ? 'Done' : `next: ${label}`) : beatBpm ? `${beatBpm} bpm` : 'tap the beat'}</span>
      </button>
      {result && (
        <div className="card" data-testid="tap-result">
          <strong>{result.bpm} bpm</strong> <span className="dim small">(timing fit ±{result.errorMs.toFixed(0)} ms)</span>
          <p className="small" style={{ wordBreak: 'break-word' }}>{result.units.map((u) => VALUE_NAMES[u] ?? `${u}/16`).join('  ')}</p>
        </div>
      )}
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={reset}>Start over</button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          data-testid="apply-rhythm"
          disabled={mode === 'notes' ? !result : !beatBpm}
          onClick={() => {
            if (mode === 'notes' && result) onApply({ units: result.units, bpm: result.bpm, method: 'taps' });
            else if (beatBpm) onApply({ units: null, bpm: beatBpm, method: 'tempo' });
          }}
        >
          Use this rhythm
        </button>
      </div>
    </Sheet>
  );
}
