import type { ExportInfo } from '../export/exporter';
import type { SyncReport } from '../export/syncCheck';
import type { Timeline } from '../engine/timeline';
import type { RiffSource } from '../import/source';
import type { TranscribedRiff } from '../import/transcribeRiff';
import type { AiNote, AiTabCheck } from '../import/aiRiff';
import type { RiffEdit } from '../engine/edits';
import type { TeachOptions } from '../engine/teach';
import type { RenderStyle } from '../render/style';
import type { ToneSettings } from '../audio/tone';

export type SoundMode = 'synth' | 'synth-click' | 'silent';

export type RiffConfig = {
  source: RiffSource;
  trackIndex: number;
  leadInMs: number;
  title?: string;
  edits?: RiffEdit[];
  teach?: TeachOptions;
  /** Silent mode: play the riff at this tempo (scaled on the score, so visuals stay exact). */
  tempoBpm?: number;
  /** General MIDI program for the guitar track (instrument chosen in the Sound tab). */
  program?: number;
  /** Per-note confidence by ref key (audio transcription). */
  noteConfidence?: Record<string, number>;
};

export type TrackInfo = { index: number; name: string; strings: number };

export type WorkerRequest =
  | { id: number; type: 'inspect'; source: RiffSource }
  | { id: number; type: 'timeline'; riff: RiffConfig }
  | { id: number; type: 'checkAi'; alphaTex: string; notes: AiNote[] }
  | { id: number; type: 'transcribe'; pcm: Float32Array<ArrayBuffer>; sampleRate: number; modelUrl: string; tuning: number[]; capo: number; title: string }
  | { id: number; type: 'prepare'; riff: RiffConfig; soundFontUrl: string; soundMode: SoundMode; tone: ToneSettings }
  | {
      id: number;
      type: 'export';
      riff: RiffConfig;
      fps: 30 | 60;
      style: RenderStyle;
      soundMode: SoundMode;
      tone: ToneSettings;
      soundFontUrl: string;
      modelUrl: string;
    };

export type ExportStage = 'prepare' | 'audio' | 'render' | 'verify-audio' | 'verify-pitch' | 'verify-frames' | 'transcribe';

export type Inspected = { title: string; artist: string; tracks: TrackInfo[] };
export type Prepared = { timeline: Timeline; warnings: string[]; editErrors: string[]; pcm: Float32Array<ArrayBuffer>; sampleRate: number; lufs: number };
export type Exported = { mp4: ArrayBuffer; info: ExportInfo; report: SyncReport; timeline: Timeline; warnings: string[] };

export type WorkerResponse =
  | { id: number; type: 'progress'; stage: ExportStage; fraction: number; frame?: number; frames?: number }
  | { id: number; type: 'inspected'; result: Inspected }
  | { id: number; type: 'prepared'; result: Prepared }
  | { id: number; type: 'timeline'; result: Timeline }
  | { id: number; type: 'checkedAi'; result: AiTabCheck }
  | { id: number; type: 'transcribed'; result: TranscribedRiff }
  | { id: number; type: 'exported'; result: Exported }
  | { id: number; type: 'error'; message: string; details: string[] };
