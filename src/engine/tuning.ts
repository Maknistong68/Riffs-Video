const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12]!;
}

const KNOWN: Record<string, string> = {
  '64,59,55,50,45,40': 'Standard tuning',
  '64,59,55,50,45,38': 'Drop D',
  '63,58,54,49,44,39': 'Eb standard',
  '62,57,53,48,43,38': 'D standard',
  '62,59,55,50,45,38': 'Double drop D',
  '62,57,55,50,45,38': 'DADGAD',
  '62,59,55,50,43,38': 'Open G',
  '64,59,56,52,47,40': 'Open E',
  '62,57,54,50,45,38': 'Open D',
  '64,59,55,50,45,40,35': '7-string standard',
  '43,38,33,28': 'Bass standard',
};

/** Human label, e.g. "Drop D · capo 2" or "D A D G B E" (low → high). */
export function tuningLabel(tuning: readonly number[], capo: number): string {
  const name = KNOWN[tuning.join(',')] ?? [...tuning].reverse().map(noteName).join(' ');
  return capo > 0 ? `${name} · capo ${capo}` : name;
}
