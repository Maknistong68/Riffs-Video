export type Theme = {
  background: string;
  text: string;
  textDim: string;
  wood: string;
  woodEdge: string;
  fretWire: string;
  nut: string;
  inlay: string;
  string: string;
  stringActive: string;
  dot: string;
  dotText: string;
  laneBg: string;
  laneLine: string;
  noteBox: string;
  noteBoxActive: string;
  noteText: string;
  playhead: string;
};

export const DARK_THEME: Theme = {
  background: '#0d0f14',
  text: '#f4f4f6',
  textDim: '#8a8f9c',
  wood: '#3b2414',
  woodEdge: '#1e120a',
  fretWire: '#c9ccd2',
  nut: '#efe6cf',
  inlay: '#e8e2d0',
  string: '#b9b2a2',
  stringActive: '#ffd34d',
  /** Must stay far from wood/background colours: the Sync Report samples it from decoded frames. */
  dot: '#ffcc1a',
  dotText: '#1a1205',
  laneBg: '#161a22',
  laneLine: '#3a4150',
  noteBox: '#262c38',
  noteBoxActive: '#ffcc1a',
  noteText: '#f4f4f6',
  playhead: '#ff4d6d',
};

/** TikTok / Shorts UI overlays. Editable constants (CLAUDE.md §4, P17). */
export const SAFE_ZONES = {
  rightPx: 140,
  bottomPx: 420,
  topPx: 120,
};
