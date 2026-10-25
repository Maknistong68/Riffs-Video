import type { Timeline } from './timeline';

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E', 'B'];

/** Plain text tab of the riff (strings × note columns, bar lines) for the preview card. */
export function tabPreview(t: Timeline): string {
  const lines = t.tuning.map(() => [] as string[]);
  const bars = t.bars.map((b) => b.startMs);
  let bar = 0;
  let i = 0;
  while (i < t.events.length) {
    const at = t.events[i]!.startMs;
    while (bar + 1 < bars.length && at >= bars[bar + 1]!) {
      bar++;
      lines.forEach((l) => l.push('|'));
    }
    const col = t.events.filter((e, k) => k >= i && e.startMs === at);
    const width = Math.max(...col.map((e) => String(e.fret).length));
    lines.forEach((l, s) => {
      const e = col.find((x) => x.stringIdx === s);
      l.push((e ? String(e.fret) : '').padEnd(width, '-') + '-');
    });
    i += col.length;
  }
  return lines.map((l, s) => `${STRING_NAMES[s] ?? '?'}|-${l.join('')}|`).join('\n');
}
