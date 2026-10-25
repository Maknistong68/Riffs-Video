import { INSTRUMENTS, TONE_PRESETS, tonePreset, type DriveType, type InstrumentId, type ToneSettings } from '../../audio/tone';
import { Segmented } from '../../components/Segmented';

type PedalKey = 'compressor' | 'drive' | 'amp' | 'chorus' | 'delay' | 'reverb';

const PEDALS: { key: PedalKey; name: string; color: string }[] = [
  { key: 'compressor', name: 'Compressor', color: '#3b82f6' },
  { key: 'drive', name: 'Drive', color: '#f97316' },
  { key: 'amp', name: 'Amp + cabinet', color: '#a3a3a3' },
  { key: 'chorus', name: 'Chorus', color: '#22d3ee' },
  { key: 'delay', name: 'Delay', color: '#a78bfa' },
  { key: 'reverb', name: 'Reverb', color: '#34d399' },
];

/** Sound tab: instrument, one-tap tone presets and a pedalboard with knobs. */
export function ToneControls({ tone, onChange }: { tone: ToneSettings; onChange: (t: ToneSettings) => void }) {
  const edit = <K extends PedalKey>(key: K, patch: Partial<ToneSettings[K]>) => onChange({ ...tone, preset: 'custom', [key]: { ...tone[key], ...patch } });

  const knob = <K extends PedalKey>(key: K, field: keyof ToneSettings[K] & string, label: string, min = 0, max = 1, step = 0.01, fmt?: (v: number) => string) => {
    const v = tone[key][field] as number;
    return (
      <label className="knob" key={field}>
        <span>{label}<b>{fmt ? fmt(v) : Math.round(((v - min) / (max - min)) * 10)}</b></span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          aria-label={`${PEDALS.find((p) => p.key === key)!.name} ${label}`}
          onChange={(e) => edit(key, { [field]: Number(e.target.value) } as Partial<ToneSettings[K]>)}
        />
      </label>
    );
  };

  return (
    <div className="tone" data-testid="tone-controls">
      <label className="field">
        <span>Instrument</span>
        <select className="input" value={tone.instrument} aria-label="Instrument" onChange={(e) => onChange({ ...tone, preset: 'custom', instrument: e.target.value as InstrumentId })}>
          {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <div className="field">
        <span>Tone presets</span>
        <div className="chips" role="radiogroup" aria-label="Tone preset">
          {TONE_PRESETS.map((p) => (
            <button key={p.id} role="radio" aria-checked={tone.preset === p.id} className={`chip ${tone.preset === p.id ? 'on' : ''}`} onClick={() => onChange(tonePreset(p.id))}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Pedalboard (signal flows top to bottom)</span>
        {PEDALS.map((p) => {
          const on = tone[p.key].on;
          return (
            <div key={p.key} className={`pedal ${on ? 'on' : ''}`} style={{ ['--pedal' as string]: p.color }} data-testid={`pedal-${p.key}`}>
              <button className="stomp" aria-pressed={on} aria-label={`${p.name} ${on ? 'on' : 'off'}`} onClick={() => edit(p.key, { on: !on } as Partial<ToneSettings[typeof p.key]>)}>
                <span className="led" />
                <strong>{p.name}</strong>
              </button>
              {on && (
                <div className="knobs">
                  {p.key === 'compressor' && knob('compressor', 'amount', 'Squash')}
                  {p.key === 'drive' && (
                    <>
                      <Segmented<DriveType> label="Drive type" value={tone.drive.type} onChange={(type) => edit('drive', { type })} options={[{ value: 'overdrive', label: 'Overdrive' }, { value: 'distortion', label: 'Distortion' }, { value: 'fuzz', label: 'Fuzz' }]} />
                      {knob('drive', 'gain', 'Gain')}
                      {knob('drive', 'tone', 'Tone')}
                    </>
                  )}
                  {p.key === 'amp' && (
                    <>
                      {knob('amp', 'gain', 'Gain')}
                      {knob('amp', 'bass', 'Bass')}
                      {knob('amp', 'mid', 'Mid')}
                      {knob('amp', 'treble', 'Treble')}
                    </>
                  )}
                  {p.key === 'chorus' && (
                    <>
                      {knob('chorus', 'rate', 'Rate')}
                      {knob('chorus', 'depth', 'Depth')}
                      {knob('chorus', 'mix', 'Mix')}
                    </>
                  )}
                  {p.key === 'delay' && (
                    <>
                      {knob('delay', 'timeMs', 'Time', 60, 900, 10, (v) => `${Math.round(v)} ms`)}
                      {knob('delay', 'feedback', 'Repeats', 0, 0.85)}
                      {knob('delay', 'mix', 'Mix', 0, 0.6)}
                    </>
                  )}
                  {p.key === 'reverb' && (
                    <>
                      {knob('reverb', 'size', 'Size')}
                      {knob('reverb', 'mix', 'Mix', 0, 0.6)}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
