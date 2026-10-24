import { useEffect, useRef } from 'react';
import type { Timeline } from '../engine/timeline';
import { firstFrameAtOrAfter } from '../engine/time';
import { defaultFrameSettings, drawFrame } from '../render/drawFrame';

/** Small render of the riff's first note — the same drawFrame as the video, scaled. */
export function Thumbnail({ timeline }: { timeline: Timeline | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !timeline) return;
    const s = defaultFrameSettings(30);
    const scale = c.width / s.width;
    ctx.save();
    ctx.scale(scale, scale);
    const first = timeline.events[0];
    drawFrame(ctx, timeline, first ? firstFrameAtOrAfter(first.startMs + 40, 30) : 0, s);
    ctx.restore();
  }, [timeline]);
  return <canvas ref={ref} className="thumb" width={108} height={192} aria-hidden="true" />;
}
