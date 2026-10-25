import { useState } from 'react';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import type { DurationValue, EditableTechnique, RiffEdit } from '../../engine/edits';
import { positionsFor } from '../../engine/fingering';
import type { Flag, ReviewNote } from '../../engine/review';
import { MAX_FRET, type Timeline } from '../../engine/timeline';
import { noteName } from '../../engine/tuning';

const TECHS: { tech: EditableTechnique; label: string; on: (n: ReviewNote) => boolean; hint?: string }[] = [
  { tech: 'hammer', label: 'Hammer/pull', on: (n) => n.tech.includes('hammer') || n.tech.includes('pull'), hint: 'from previous note' },
  { tech: 'slide', label: 'Slide', on: (n) => n.tech.includes('slide') && !!n.legato, hint: 'from previous note' },
  { tech: 'palmMute', label: 'Palm mute', on: (n) => n.tech.includes('palmMute') },
  { tech: 'vibrato', label: 'Vibrato', on: (n) => n.tech.includes('vibrato') },
  { tech: 'harmonic', label: 'Harmonic', on: (n) => n.tech.includes('harmonic') },
  { tech: 'dead', label: 'Dead (x)', on: (n) => n.tech.includes('dead') },
];

/** Tap-a-note editor (S4). Every change is a RiffEdit applied to the score → audio follows. */
export function NoteEditor({
  note,
  timeline,
  flags,
  onEdit,
  onClose,
}: {
  note: ReviewNote;
  timeline: Timeline;
  flags: Flag[];
  onEdit: (e: RiffEdit) => void;
  onClose: () => void;
}) {
  const [fret, setFret] = useState(note.fret);
  const strings = timeline.tuning.length;
  const names = timeline.tuning.map((m, i) => (i === 0 ? noteName(m).toLowerCase() : noteName(m)));
  const ref = note.ref;
  const move = (stringIdx: number, f: number) => onEdit({ kind: 'position', ref, stringIdx, fret: f });
  const alternatives = positionsFor(note.midi, timeline.tuning, timeline.capo).filter((p) => p.stringIdx !== note.stringIdx);
  const bendOn = note.tech.includes('bend');

  return (
    <Sheet onClose={onClose} label="Edit note">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          {noteName(note.midi)} · string {note.stringIdx + 1} · fret {note.fret}
        </h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      {flags.length > 0 && (
        <div className={flags.some((f) => f.level === 'error') ? 'errors' : 'notice'}>
          {flags.map((f, i) => <span key={i}>{f.message}</span>)}
        </div>
      )}

      <div className="field">
        <span>String</span>
        <Segmented<number>
          label="String"
          value={note.stringIdx}
          onChange={(s) => move(s, note.fret)}
          options={names.map((n, i) => ({ value: i, label: n }))}
        />
      </div>
      <div className="field">
        <span>Fret (changes the pitch)</span>
        <div className="row">
          <button className="btn" aria-label="Fret down" disabled={fret <= 0} onClick={() => { setFret(fret - 1); move(note.stringIdx, fret - 1); }}>−</button>
          <strong style={{ fontSize: 24, minWidth: 48, textAlign: 'center' }} data-testid="fret-value">{fret}</strong>
          <button className="btn" aria-label="Fret up" disabled={fret >= MAX_FRET} onClick={() => { setFret(fret + 1); move(note.stringIdx, fret + 1); }}>+</button>
          <span className="dim small">{noteName(timeline.tuning[note.stringIdx]! + timeline.capo + fret)}</span>
        </div>
      </div>
      {alternatives.length > 0 && (
        <div className="field">
          <span>Same pitch elsewhere</span>
          <div className="row">
            {alternatives.map((p) => (
              <button key={p.stringIdx} className="btn" style={{ minHeight: 40 }} onClick={() => move(p.stringIdx, p.fret)}>
                {names[p.stringIdx]} {p.fret}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span>Duration</span>
        <Segmented<DurationValue>
          label="Duration"
          value={nearestDuration(note, timeline)}
          onChange={(d) => onEdit({ kind: 'duration', ref: { bar: ref.bar, voice: ref.voice, beat: ref.beat }, duration: d, dots: 0 })}
          options={([1, 2, 4, 8, 16, 32] as const).map((d) => ({ value: d, label: d === 1 ? '1' : `1/${d}` }))}
        />
      </div>

      <div className="field">
        <span>Techniques</span>
        <div className="row">
          {TECHS.map((t) => {
            const on = t.on(note);
            return (
              <button
                key={t.tech}
                className={`btn ${on ? 'primary' : ''}`}
                style={{ minHeight: 40, fontSize: 14 }}
                aria-pressed={on}
                title={t.hint}
                onClick={() => onEdit({ kind: 'technique', ref, tech: t.tech, on: !on })}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <Segmented<number>
          label="Bend"
          value={bendOn ? note.bendSemitones ?? 2 : 0}
          onChange={(v) => onEdit(v === 0 ? { kind: 'technique', ref, tech: 'bend', on: false } : { kind: 'technique', ref, tech: 'bend', on: true, bendSemitones: v })}
          options={[{ value: 0, label: 'No bend' }, { value: 1, label: '½' }, { value: 2, label: 'Full' }, { value: 3, label: '1½' }]}
        />
      </div>

      <div className="field">
        <span>Finger</span>
        <Segmented<string>
          label="Finger"
          value={note.finger === undefined ? 'auto' : String(note.finger)}
          onChange={(v) => onEdit({ kind: 'finger', ref, finger: v === 'auto' ? null : v === 'T' ? 'T' : (Number(v) as 1 | 2 | 3 | 4) })}
          options={[{ value: 'auto', label: 'Auto' }, ...['1', '2', '3', '4', 'T'].map((f) => ({ value: f, label: f }))]}
        />
      </div>

      <button className="btn danger block" onClick={() => { onEdit({ kind: 'deleteNote', ref }); onClose(); }}>Delete note</button>
      <p className="dim small">Strings: {names.join(' ')} (string 1 = {names[0]}, {strings} strings).</p>
    </Sheet>
  );
}

/** Closest standard note value for display (the score holds the real value). */
function nearestDuration(note: ReviewNote, t: Timeline): DurationValue {
  let bpm = t.tempoMap[0]?.bpm ?? 120;
  for (const x of t.tempoMap) if (x.ms <= note.startMs) bpm = x.bpm;
  const beats = (note.barEndMs - note.barStartMs) > 0 ? note.durationMs / (60_000 / bpm) : 1;
  const opts: DurationValue[] = [1, 2, 4, 8, 16, 32];
  return opts.reduce((best, d) => (Math.abs(Math.log2(4 / d / beats)) < Math.abs(Math.log2(4 / best / beats)) ? d : best), 4 as DurationValue);
}
