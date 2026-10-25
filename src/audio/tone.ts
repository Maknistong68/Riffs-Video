/**
 * Guitar tone: which sampled instrument plays the notes and the pedal/amp chain after it.
 * Pure data (no DSP here) so the UI can import it without pulling in audio code.
 * The DSP lives in fx.ts and runs in the worker, identically for preview and export.
 */
import type { SkinId } from '../render/skins';

export type InstrumentId = 'electric' | 'jazz' | 'acoustic' | 'nylon' | 'bass';
export type DriveType = 'overdrive' | 'distortion' | 'fuzz';

/** All knob values are 0..1 unless stated otherwise. */
export type ToneSettings = {
  /** Preset last applied, or 'custom' once a knob was changed. */
  preset: string;
  instrument: InstrumentId;
  compressor: { on: boolean; amount: number };
  drive: { on: boolean; type: DriveType; gain: number; tone: number };
  /** Amp head + speaker cabinet. Off = straight into the desk (acoustic / DI). */
  amp: { on: boolean; gain: number; bass: number; mid: number; treble: number };
  chorus: { on: boolean; rate: number; depth: number; mix: number };
  delay: { on: boolean; timeMs: number; feedback: number; mix: number };
  reverb: { on: boolean; size: number; mix: number };
};

export const INSTRUMENTS: { id: InstrumentId; name: string; program: number }[] = [
  // General MIDI programs of the SoundFont. Electric = clean DI, so the amp/pedals shape it.
  { id: 'electric', name: 'Electric', program: 27 },
  { id: 'jazz', name: 'Jazz (hollow body)', program: 26 },
  { id: 'acoustic', name: 'Acoustic (steel)', program: 25 },
  { id: 'nylon', name: 'Classical (nylon)', program: 24 },
  { id: 'bass', name: 'Bass', program: 33 },
];

export function programOf(id: InstrumentId): number {
  return INSTRUMENTS.find((i) => i.id === id)?.program ?? 27;
}

const OFF = {
  compressor: { on: false, amount: 0.3 },
  drive: { on: false, type: 'overdrive' as DriveType, gain: 0.5, tone: 0.5 },
  amp: { on: false, gain: 0.2, bass: 0.5, mid: 0.5, treble: 0.5 },
  chorus: { on: false, rate: 0.3, depth: 0.5, mix: 0.4 },
  delay: { on: false, timeMs: 380, feedback: 0.35, mix: 0.25 },
  reverb: { on: false, size: 0.5, mix: 0.18 },
};

type PresetDef = { id: string; name: string; tone: Omit<ToneSettings, 'preset'> };

export const TONE_PRESETS: PresetDef[] = [
  {
    id: 'clean',
    name: 'Clean',
    tone: { ...OFF, instrument: 'electric', compressor: { on: true, amount: 0.3 }, amp: { on: true, gain: 0.2, bass: 0.5, mid: 0.5, treble: 0.6 }, reverb: { on: true, size: 0.45, mix: 0.18 } },
  },
  {
    id: 'crunch',
    name: 'Crunch',
    tone: { ...OFF, instrument: 'electric', drive: { on: true, type: 'overdrive', gain: 0.45, tone: 0.55 }, amp: { on: true, gain: 0.45, bass: 0.5, mid: 0.6, treble: 0.55 }, reverb: { on: true, size: 0.35, mix: 0.14 } },
  },
  {
    id: 'rock',
    name: 'Rock',
    tone: { ...OFF, instrument: 'electric', drive: { on: true, type: 'distortion', gain: 0.65, tone: 0.5 }, amp: { on: true, gain: 0.55, bass: 0.55, mid: 0.5, treble: 0.55 }, reverb: { on: true, size: 0.35, mix: 0.12 } },
  },
  {
    id: 'metal',
    name: 'Metal',
    tone: {
      ...OFF,
      instrument: 'electric',
      compressor: { on: true, amount: 0.4 },
      drive: { on: true, type: 'distortion', gain: 0.9, tone: 0.45 },
      amp: { on: true, gain: 0.7, bass: 0.65, mid: 0.3, treble: 0.62 },
      reverb: { on: true, size: 0.3, mix: 0.08 },
    },
  },
  {
    id: 'lead',
    name: 'Lead',
    tone: {
      ...OFF,
      instrument: 'electric',
      drive: { on: true, type: 'distortion', gain: 0.75, tone: 0.55 },
      amp: { on: true, gain: 0.55, bass: 0.5, mid: 0.65, treble: 0.55 },
      delay: { on: true, timeMs: 380, feedback: 0.35, mix: 0.22 },
      reverb: { on: true, size: 0.6, mix: 0.2 },
    },
  },
  {
    id: 'fuzz',
    name: 'Fuzz',
    tone: { ...OFF, instrument: 'electric', drive: { on: true, type: 'fuzz', gain: 0.7, tone: 0.45 }, amp: { on: true, gain: 0.4, bass: 0.6, mid: 0.5, treble: 0.5 }, reverb: { on: true, size: 0.4, mix: 0.12 } },
  },
  {
    id: 'ambient',
    name: 'Ambient',
    tone: {
      ...OFF,
      instrument: 'electric',
      compressor: { on: true, amount: 0.35 },
      amp: { on: true, gain: 0.2, bass: 0.45, mid: 0.5, treble: 0.6 },
      chorus: { on: true, rate: 0.25, depth: 0.55, mix: 0.45 },
      delay: { on: true, timeMs: 450, feedback: 0.45, mix: 0.28 },
      reverb: { on: true, size: 0.85, mix: 0.32 },
    },
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    tone: {
      ...OFF,
      instrument: 'electric',
      compressor: { on: true, amount: 0.35 },
      amp: { on: true, gain: 0.12, bass: 0.6, mid: 0.45, treble: 0.25 },
      chorus: { on: true, rate: 0.15, depth: 0.7, mix: 0.4 },
      reverb: { on: true, size: 0.65, mix: 0.24 },
    },
  },
  {
    id: 'jazz',
    name: 'Jazz',
    tone: { ...OFF, instrument: 'jazz', amp: { on: true, gain: 0.15, bass: 0.6, mid: 0.5, treble: 0.35 }, reverb: { on: true, size: 0.4, mix: 0.14 } },
  },
  {
    id: 'acoustic',
    name: 'Acoustic',
    tone: { ...OFF, instrument: 'acoustic', compressor: { on: true, amount: 0.3 }, reverb: { on: true, size: 0.5, mix: 0.18 } },
  },
  {
    id: 'nylon',
    name: 'Nylon',
    tone: { ...OFF, instrument: 'nylon', reverb: { on: true, size: 0.55, mix: 0.2 } },
  },
  {
    id: 'bass',
    name: 'Bass',
    tone: { ...OFF, instrument: 'bass', compressor: { on: true, amount: 0.5 }, amp: { on: true, gain: 0.3, bass: 0.6, mid: 0.5, treble: 0.45 } },
  },
];

export function tonePreset(id: string): ToneSettings {
  const p = TONE_PRESETS.find((x) => x.id === id) ?? TONE_PRESETS[0]!;
  return structuredClone({ ...p.tone, preset: p.id });
}

/** A sensible starting tone for each guitar model. */
export function toneForSkin(skin: SkinId): ToneSettings {
  if (skin === 'acoustic') return tonePreset('acoustic');
  if (skin === 'classical') return tonePreset('nylon');
  if (skin === 'bass4') return tonePreset('bass');
  if (skin === 'lespaul') return tonePreset('crunch');
  return tonePreset('clean');
}
