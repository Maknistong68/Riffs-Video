/** Basic Pitch wrapper: 48 kHz mono PCM → detected notes (ms, MIDI). Runs inside a worker. */
import type * as tfType from '@tensorflow/tfjs';
import { resample } from './resample';

export type DetectedNote = {
  startMs: number;
  durationMs: number;
  midi: number;
  amplitude: number;
};

export const BASIC_PITCH_RATE = 22_050;

export async function transcribe(
  model: Promise<tfType.GraphModel>,
  pcm: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Promise<DetectedNote[]> {
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await import('@spotify/basic-pitch');
  const input = resample(pcm, sampleRate, BASIC_PITCH_RATE);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await new BasicPitch(model).evaluateModel(
    input,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );
  // Thresholds from Basic Pitch's defaults (onset 0.5, frame 0.3, min length 5 frames ≈ 58 ms).
  const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)));
  return notes
    .map((n) => ({
      startMs: n.startTimeSeconds * 1000,
      durationMs: n.durationSeconds * 1000,
      midi: n.pitchMidi,
      amplitude: n.amplitude,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);
}
