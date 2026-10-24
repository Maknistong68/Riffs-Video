/// <reference lib="webworker" />
/**
 * Heavy work off the UI thread: parse, timeline, synth, render + encode, Sync Report.
 * Everything is derived from the RiffSource inside this worker, deterministically.
 */
import { normaliseLoudness } from '../audio/mix';
import { fetchSoundFont } from '../audio/soundpacks';
import { renderSynth } from '../audio/synth';
import { transcribe } from '../audio/transcribe';
import { buildTimeline, DEFAULT_BUILD } from '../engine/buildTimeline';
import { AUDIO_SAMPLE_RATE } from '../engine/time';
import { exportMp4, planExport } from '../export/exporter';
import { frameCount, samplesForFrames } from '../engine/time';
import { verifyExport } from '../export/verify';
import { playableTracks, ScoreImportError } from '../import/alphatab';
import { loadRiffSource } from '../import/source';
import { defaultFrameSettings } from '../render/drawFrame';
import { loadRenderFonts } from '../render/fonts';
import type { ExportStage, RiffConfig, SoundMode, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function build(riff: RiffConfig) {
  const score = loadRiffSource(riff.source);
  const opts = { ...DEFAULT_BUILD, trackIndex: riff.trackIndex, leadInMs: riff.leadInMs };
  return buildTimeline(score, riff.title ? { ...opts, title: riff.title } : opts);
}

async function renderAudio(riff: RiffConfig, built: ReturnType<typeof build>, totalSamples: number, soundFontUrl: string, mode: SoundMode, onProgress: (f: number) => void) {
  const soundFont = await fetchSoundFont(soundFontUrl);
  const pcm = renderSynth(built.prepared, {
    trackIndex: riff.trackIndex,
    sampleRate: AUDIO_SAMPLE_RATE,
    totalSamples,
    leadInMs: built.timeline.leadInMs,
    soundFont,
    metronomeVolume: mode === 'synth-click' ? 1 : 0,
    onProgress,
  });
  const loudness = normaliseLoudness(pcm, 2, AUDIO_SAMPLE_RATE);
  return { pcm, lufs: loudness.lufsAfter };
}

let tfModel: Promise<import('@tensorflow/tfjs').GraphModel> | null = null;
async function getModel(url: string) {
  tfModel ??= (async () => {
    // tfjs 3.x WebGL polling evaluates `!window`, a ReferenceError in workers. Declaring the
    // global as undefined makes it take its plain-setTimeout path (typeof window stays 'undefined').
    if (!('window' in globalThis)) Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    const tf = await import('@tensorflow/tfjs');
    try {
      await tf.setBackend('webgl');
      await tf.ready();
    } catch {
      await tf.setBackend('cpu');
      await tf.ready();
    }
    return tf.loadGraphModel(url);
  })();
  return tfModel;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const progress = (stage: ExportStage, fraction: number, extra: { frame?: number; frames?: number } = {}) =>
    post({ id: req.id, type: 'progress', stage, fraction, ...extra });
  try {
    if (req.type === 'inspect') {
      const score = loadRiffSource(req.source);
      post({ id: req.id, type: 'inspected', result: { title: score.title, artist: score.artist, tracks: playableTracks(score) } });
      return;
    }
    if (req.type === 'timeline') {
      post({ id: req.id, type: 'timeline', result: build(req.riff).timeline });
      return;
    }
    if (req.type === 'prepare') {
      const built = build(req.riff);
      const total = samplesForFrames(frameCount(built.timeline.durationMs, 60), 60);
      const { pcm, lufs } = await renderAudio(req.riff, built, total, req.soundFontUrl, req.soundMode, (f) => progress('audio', f));
      post({ id: req.id, type: 'prepared', result: { timeline: built.timeline, warnings: built.warnings, pcm, sampleRate: AUDIO_SAMPLE_RATE, lufs } }, [pcm.buffer]);
      return;
    }
    // export
    progress('prepare', 0);
    const [built] = await Promise.all([Promise.resolve(build(req.riff)), loadRenderFonts()]);
    const settings = defaultFrameSettings(req.fps);
    const plan = await planExport(built.timeline, settings);
    const { pcm } = await renderAudio(req.riff, built, plan.totalSamples, req.soundFontUrl, req.soundMode, (f) => progress('audio', f));
    const { data, info } = await exportMp4(built.timeline, pcm, settings, plan, (p) =>
      progress('render', p.frame / p.frames, { frame: p.frame, frames: p.frames }),
    );
    const report = await verifyExport(
      data,
      built.timeline,
      settings,
      plan.frames,
      async (mono, sr) => transcribe(getModel(req.modelUrl), mono, sr, (f) => progress('verify-pitch', f)),
      (stage) => progress(stage === 'audio' ? 'verify-audio' : stage === 'pitch' ? 'verify-pitch' : 'verify-frames', 0),
    );
    report.audioLatencySamples = info.audioLatencySamples;
    post({ id: req.id, type: 'exported', result: { mp4: data, info, report, timeline: built.timeline, warnings: built.warnings } }, [data]);
  } catch (e) {
    const details = e instanceof ScoreImportError ? e.details : [];
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e), details });
  }
};
