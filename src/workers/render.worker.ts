/// <reference lib="webworker" />
/**
 * Heavy work off the UI thread: parse, timeline, synth, render + encode, Sync Report.
 * Everything is derived from the RiffSource inside this worker, deterministically.
 */
import { applyTone } from '../audio/fx';
import { normaliseLoudness } from '../audio/mix';
import type { ToneSettings } from '../audio/tone';
import { renderDrums, type DrumSettings } from '../audio/drums';
import { fetchSoundFont } from '../audio/soundpacks';
import { renderArrangement, toMono } from '../audio/synth';
import { transcribe } from '../audio/transcribe';
import { buildArrangement, NO_TEACH, scaleTempo } from '../engine/arrange';
import { buildTimeline, DEFAULT_BUILD } from '../engine/buildTimeline';
import { applyEdits } from '../engine/edits';
import { refKey } from '../engine/review';
import { transcribeToRiff } from '../import/transcribeRiff';
import { checkAiTab } from '../import/aiRiff';
import { detectOnsets } from '../audio/onsets';
import { rmsEnvelope } from '../audio/envelope';
import { AUDIO_SAMPLE_RATE } from '../engine/time';
import { exportMp4, planExport } from '../export/exporter';
import { frameCount, samplesForFrames } from '../engine/time';
import { verifyExport } from '../export/verify';
import { loadAlphaTex, playableTracks, ScoreImportError } from '../import/alphatab';
import { loadRiffSource } from '../import/source';
import { defaultFrameSettings } from '../render/drawFrame';
import { loadRenderFonts } from '../render/fonts';
import { ensureNeck3d } from '../render/neck3dRegistry';
import type { Benchmark, ExportStage, RiffConfig, SoundMode, WorkerRequest, WorkerResponse } from './protocol';
import type { RenderStyle } from '../render/style';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

/** Source → edits → arrangement (teach passes) → one composite timeline. */
function build(riff: RiffConfig) {
  let editErrors: string[] = [];
  const makeScore = () => {
    const score = loadRiffSource(riff.source);
    editErrors = applyEdits(score, riff.trackIndex, riff.edits ?? []).errors;
    const track = score.tracks[riff.trackIndex];
    if (track && riff.program !== undefined) track.playbackInfo.program = riff.program;
    if (riff.tempoBpm && score.tempo > 0 && Math.abs(riff.tempoBpm - score.tempo) > 0.01) scaleTempo(score, riff.tempoBpm / score.tempo);
    return score;
  };
  const arr = buildArrangement(makeScore, {
    trackIndex: riff.trackIndex,
    leadInMs: riff.leadInMs,
    tailMs: riff.tailMs ?? DEFAULT_BUILD.tailMs,
    teach: riff.teach ?? NO_TEACH,
    ...(riff.title ? { title: riff.title } : {}),
  });
  if (riff.noteConfidence) {
    for (const e of arr.timeline.events) {
      const c = e.ref ? riff.noteConfidence[refKey(e.ref)] : undefined;
      if (c !== undefined) e.confidence = c;
    }
  }
  return { arrangement: arr, timeline: arr.timeline, warnings: arr.warnings, editErrors };
}

/** Last dry synth render: turning a pedal knob re-runs only the effects, not the synth. */
let dryCache: { key: string; pcm: Float32Array<ArrayBuffer>; click: Float32Array<ArrayBuffer> | null } | null = null;

const peakOf = (x: Float32Array) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
};

/** Add the click at the level it had next to the dry guitar (the effects chain renormalises the guitar). */
function mixClick(wet: Float32Array, dry: Float32Array, click: Float32Array): void {
  const pd = peakOf(dry);
  const g = pd > 0 ? peakOf(wet) / pd : 1;
  for (let i = 0; i < wet.length; i++) wet[i]! += click[i]! * g;
}

/** Drums (peak 1) at `volume` relative to the processed guitar's peak; bypasses the pedals. */
function mixDrums(wet: Float32Array, drums: Float32Array, volume: number): void {
  const g = peakOf(wet) * Math.max(0, Math.min(1.5, volume)) * 0.9;
  for (let i = 0; i < wet.length; i++) wet[i]! += drums[i]! * g;
}

async function renderAudio(riff: RiffConfig, built: ReturnType<typeof build>, totalSamples: number, soundFontUrl: string, mode: SoundMode, tone: ToneSettings, drums: DrumSettings | undefined, onProgress: (f: number) => void) {
  // Silent / timing-only: a silent track (platforms add the official sound). No synth at all.
  if (mode === 'silent') return { pcm: new Float32Array(totalSamples * 2), lufs: -Infinity, dry: null };
  const key = JSON.stringify({ riff, totalSamples, soundFontUrl, mode });
  let dry = dryCache?.key === key ? dryCache.pcm : null;
  if (!dry) {
    const soundFont = await fetchSoundFont(soundFontUrl);
    const click = mode === 'synth-click';
    const common = { trackIndex: riff.trackIndex, sampleRate: AUDIO_SAMPLE_RATE, totalSamples, soundFont };
    dry = renderArrangement(built.arrangement, { ...common, metronomeVolume: 0, onProgress: (f) => onProgress(click ? f * 0.7 : f) });
    // The click is rendered on its own so it bypasses the pedals and amp.
    const clickPcm = click ? renderArrangement(built.arrangement, { ...common, metronomeVolume: 1, trackVolume: 0, onProgress: (f) => onProgress(0.7 + f * 0.3) }) : null;
    dryCache = { key, pcm: dry, click: clickPcm };
  }
  const pcm = applyTone(dry, AUDIO_SAMPLE_RATE, tone);
  const clickPcm = dryCache?.click;
  if (clickPcm) mixClick(pcm, dry, clickPcm);
  if (drums && drums.pattern !== 'none') mixDrums(pcm, renderDrums(built.timeline, drums.pattern, AUDIO_SAMPLE_RATE, totalSamples), drums.volume);
  const loudness = normaliseLoudness(pcm, 2, AUDIO_SAMPLE_RATE);
  return { pcm, lufs: loudness.lufsAfter, dry };
}

/** A short, busy riff (chords, high frets, every string) for the speed check. */
const BENCH_TEX = '\\tempo 120\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:8 0.6 3.6 5.6 (5.5 5.4) 7.3 5.2 8.1 (12.1 12.2 13.3) |\n:8 10.1 12.2 10.3 12.4 :4 (0.6 2.5 2.4) (3.6 5.5 5.4)';

async function benchmark(style: RenderStyle, fps: 30 | 60): Promise<Benchmark> {
  await loadRenderFonts();
  if (style.view === '3d' && !(await ensureNeck3d())) return { supported: false, ratio: 0, msPerFrame: Infinity };
  const timeline = buildTimeline(loadAlphaTex(BENCH_TEX), { ...DEFAULT_BUILD, trackIndex: 0 }).timeline;
  const settings = defaultFrameSettings(fps, style);
  const plan = await planExport(timeline, settings);
  const t0 = performance.now();
  await exportMp4(timeline, new Float32Array(plan.totalSamples * 2), settings, plan, () => undefined);
  const sec = (performance.now() - t0) / 1000;
  return { supported: true, ratio: plan.frames / fps / sec, msPerFrame: (sec * 1000) / plan.frames };
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
    if (req.type === 'transcribe') {
      progress('transcribe', 0);
      const detected = await transcribe(getModel(req.modelUrl), req.pcm, req.sampleRate, (f) => progress('transcribe', f * 0.9));
      const result = transcribeToRiff(detected, detectOnsets(req.pcm, req.sampleRate), { tuning: req.tuning, capo: req.capo, title: req.title }, rmsEnvelope(req.pcm, req.sampleRate));
      post({ id: req.id, type: 'transcribed', result });
      return;
    }
    if (req.type === 'benchmark') {
      post({ id: req.id, type: 'benchmarked', result: await benchmark(req.style, req.fps) });
      return;
    }
    if (req.type === 'checkAi') {
      post({ id: req.id, type: 'checkedAi', result: checkAiTab(req.alphaTex, req.notes) });
      return;
    }
    if (req.type === 'timeline') {
      post({ id: req.id, type: 'timeline', result: build(req.riff).timeline });
      return;
    }
    if (req.type === 'prepare') {
      const built = build(req.riff);
      const total = samplesForFrames(frameCount(built.timeline.durationMs, 60), 60);
      const { pcm, lufs } = await renderAudio(req.riff, built, total, req.soundFontUrl, req.soundMode, req.tone, req.drums, (f) => progress('audio', f));
      post({ id: req.id, type: 'prepared', result: { timeline: built.timeline, warnings: built.warnings, editErrors: built.editErrors, pcm, sampleRate: AUDIO_SAMPLE_RATE, lufs } }, [pcm.buffer]);
      return;
    }
    // export
    progress('prepare', 0);
    const [built] = await Promise.all([Promise.resolve(build(req.riff)), loadRenderFonts()]);
    const settings = defaultFrameSettings(req.fps, req.style);
    if (settings.style.view === '3d' && !(await ensureNeck3d())) {
      throw new Error('This device cannot draw the 3D guitar (WebGL is unavailable here). Switch the view to 2D in the Guitar tab.');
    }
    const plan = await planExport(built.timeline, settings);
    const { pcm, dry } = await renderAudio(req.riff, built, plan.totalSamples, req.soundFontUrl, req.soundMode, req.tone, req.drums, (f) => progress('audio', f));
    const reference = dry ? { wetMono: toMono(pcm, 2), dryMono: toMono(dry, 2) } : undefined;
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
      req.soundMode !== 'silent',
      reference,
    );
    report.audioLatencySamples = info.audioLatencySamples;
    post({ id: req.id, type: 'exported', result: { mp4: data, info, report, timeline: built.timeline, warnings: built.warnings } }, [data]);
  } catch (e) {
    const details = e instanceof ScoreImportError ? e.details : [];
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e), details });
  }
};
