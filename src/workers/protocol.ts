import type { ExportInfo } from '../export/exporter';
import type { SyncReport } from '../export/syncCheck';
import type { Timeline } from '../engine/timeline';
import type { RiffSource } from '../import/source';
import type { RiffEdit } from '../engine/edits';
import type { TeachOptions } from '../engine/arrange';
import type { RenderStyle } from '../render/style';

export type SoundMode = 'synth' | 'synth-click';

export type RiffConfig = {
  source: RiffSource;
  trackIndex: number;
  leadInMs: number;
  title?: string;
  edits?: RiffEdit[];
  teach?: TeachOptions;
};

export type TrackInfo = { index: number; name: string; strings: number };

export type WorkerRequest =
  | { id: number; type: 'inspect'; source: RiffSource }
  | { id: number; type: 'timeline'; riff: RiffConfig }
  | { id: number; type: 'prepare'; riff: RiffConfig; soundFontUrl: string; soundMode: SoundMode }
  | {
      id: number;
      type: 'export';
      riff: RiffConfig;
      fps: 30 | 60;
      style: RenderStyle;
      soundMode: SoundMode;
      soundFontUrl: string;
      modelUrl: string;
    };

export type ExportStage = 'prepare' | 'audio' | 'render' | 'verify-audio' | 'verify-pitch' | 'verify-frames';

export type Inspected = { title: string; artist: string; tracks: TrackInfo[] };
export type Prepared = { timeline: Timeline; warnings: string[]; editErrors: string[]; pcm: Float32Array<ArrayBuffer>; sampleRate: number; lufs: number };
export type Exported = { mp4: ArrayBuffer; info: ExportInfo; report: SyncReport; timeline: Timeline; warnings: string[] };

export type WorkerResponse =
  | { id: number; type: 'progress'; stage: ExportStage; fraction: number; frame?: number; frames?: number }
  | { id: number; type: 'inspected'; result: Inspected }
  | { id: number; type: 'prepared'; result: Prepared }
  | { id: number; type: 'timeline'; result: Timeline }
  | { id: number; type: 'exported'; result: Exported }
  | { id: number; type: 'error'; message: string; details: string[] };
