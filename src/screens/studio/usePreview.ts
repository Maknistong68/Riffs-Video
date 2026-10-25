/**
 * Live preview transport. Visuals come from the same pure drawFrame as the export; the clock is
 * the AudioContext playing the same synth PCM, so what you see follows what you hear.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { frameCount } from '../../engine/time';
import type { Prepared } from '../../workers/protocol';

/** Optional reference recording (Silent mode): played instead of the synth, `startSec` = its time at video 0. */
export type PreviewReference = { buffer: AudioBuffer; startSec: number };

export function usePreview(prepared: Prepared | null, fps: number, initialMs = 0, reference: PreviewReference | null = null, loop = false) {
  const [frame, setFrame] = useState(() => Math.floor((initialMs * fps) / 1000));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const raf = useRef(0);
  const frames = prepared ? frameCount(prepared.timeline.durationMs, fps) : 1;
  // Loop (practice page): at the end, start again from the top.
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const [restart, setRestart] = useState(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const a = audio.current;
    audio.current = null;
    if (a) {
      a.src.onended = null;
      try {
        a.src.stop();
      } catch {
        /* already stopped */
      }
      void a.ctx.close();
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!prepared) return;
    stop();
    const ctx = new AudioContext({ sampleRate: prepared.sampleRate, latencyHint: 'interactive' });
    const src = ctx.createBufferSource();
    if (reference) {
      src.buffer = reference.buffer;
    } else {
      const n = prepared.pcm.length / 2;
      const buf = ctx.createBuffer(2, n, prepared.sampleRate);
      buf.copyToChannel(prepared.pcm.subarray(0, n), 0);
      buf.copyToChannel(prepared.pcm.subarray(n), 1);
      src.buffer = buf;
    }
    src.playbackRate.value = speed;
    src.connect(ctx.destination);
    const startFrame = frame >= frames - 1 ? 0 : frame;
    const offsetSec = startFrame / fps;
    const t0 = ctx.currentTime + 0.06;
    if (reference) {
      // Reference time for video time v is startSec + v; before the song starts, wait.
      const refAt = reference.startSec + offsetSec;
      if (refAt >= 0) src.start(t0, refAt);
      else src.start(t0 - refAt / speed, 0);
    } else {
      src.start(t0, offsetSec);
    }
    src.onended = () => {
      stop();
      if (loopRef.current) {
        setFrame(0);
        setRestart((n) => n + 1);
      }
    };
    audio.current = { ctx, src };
    setPlaying(true);
    const tick = () => {
      const a = audio.current;
      if (!a) return;
      const latency = (a.ctx.outputLatency || 0) + (a.ctx.baseLatency || 0);
      const sec = offsetSec + Math.max(0, a.ctx.currentTime - t0 - latency) * speed;
      const f = Math.floor(sec * fps);
      if (f >= frames) {
        stop();
        if (loopRef.current) {
          setFrame(0);
          setRestart((n) => n + 1);
        } else setFrame(frames - 1);
        return;
      }
      setFrame(f);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [prepared, stop, speed, frame, frames, fps, reference]);

  const seek = useCallback(
    (f: number) => {
      stop();
      setFrame(Math.max(0, Math.min(frames - 1, Math.round(f))));
    },
    [stop, frames],
  );

  useEffect(() => {
    if (restart) play();
  }, [restart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    // New audio (e.g. sound mode changed) → stop playback, keep position.
    stop();
  }, [prepared, reference, stop]);

  return { frame: Math.min(frame, frames - 1), frames, playing, play, stop, seek, speed, setSpeed };
}
