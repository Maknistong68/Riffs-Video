/**
 * Live preview transport. Visuals come from the same pure drawFrame as the export; the clock is
 * the AudioContext playing the same synth PCM, so what you see follows what you hear.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { frameCount } from '../../engine/time';
import type { Prepared } from '../../workers/protocol';

export function usePreview(prepared: Prepared | null, fps: number, initialMs = 0) {
  const [frame, setFrame] = useState(() => Math.floor((initialMs * fps) / 1000));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const raf = useRef(0);
  const frames = prepared ? frameCount(prepared.timeline.durationMs, fps) : 1;

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
    const n = prepared.pcm.length / 2;
    const buf = ctx.createBuffer(2, n, prepared.sampleRate);
    buf.copyToChannel(prepared.pcm.subarray(0, n), 0);
    buf.copyToChannel(prepared.pcm.subarray(n), 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    src.connect(ctx.destination);
    const startFrame = frame >= frames - 1 ? 0 : frame;
    const offsetSec = startFrame / fps;
    const t0 = ctx.currentTime + 0.06;
    src.start(t0, offsetSec);
    src.onended = () => stop();
    audio.current = { ctx, src };
    setPlaying(true);
    const tick = () => {
      const a = audio.current;
      if (!a) return;
      const latency = (a.ctx.outputLatency || 0) + (a.ctx.baseLatency || 0);
      const sec = offsetSec + Math.max(0, a.ctx.currentTime - t0 - latency) * speed;
      const f = Math.floor(sec * fps);
      if (f >= frames) {
        setFrame(frames - 1);
        stop();
        return;
      }
      setFrame(f);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [prepared, stop, speed, frame, frames, fps]);

  const seek = useCallback(
    (f: number) => {
      stop();
      setFrame(Math.max(0, Math.min(frames - 1, Math.round(f))));
    },
    [stop, frames],
  );

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    // New audio (e.g. sound mode changed) → stop playback, keep position.
    stop();
  }, [prepared, stop]);

  return { frame: Math.min(frame, frames - 1), frames, playing, play, stop, seek, speed, setSpeed };
}
