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
  /** Look-ahead rings. */
  ghost: string;
  /** Technique glyphs (arcs, arrows, PM). */
  glyph: string;
  badge: string;
  badgeText: string;
  /** Optional vertical background gradient (top → bottom); otherwise `background` fills the frame. */
  backgroundTop?: string;
  backgroundBottom?: string;
};

export const DARK_THEME: Theme = {
  background: '#0d0f14',
  backgroundTop: '#07080c',
  backgroundBottom: '#141826',
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
  playhead: '#ffcc1a',
  ghost: '#f2f2f2',
  glyph: '#e9f6ff',
  badge: '#2a3140',
  badgeText: '#f4f4f6',
};

export type ThemeId = 'dark' | 'metal' | 'blues' | 'lofi' | 'acoustic';

/**
 * Genre themes (phase 6). Each `dot` must stay far (> 70 in RGB) from every skin's wood and the
 * background: the Sync Report finds highlights by that colour in the decoded video.
 */
export const THEMES: Record<ThemeId, Theme> = {
  dark: DARK_THEME,
  metal: {
    ...DARK_THEME,
    background: '#0a0808',
    backgroundTop: '#050505',
    backgroundBottom: '#2a0606',
    textDim: '#b09090',
    stringActive: '#ff6b6b',
    dot: '#ff2d3c',
    dotText: '#ffffff',
    laneBg: '#160d0d',
    laneLine: '#4a2a2a',
    noteBox: '#2c1818',
    noteBoxActive: '#ff2d3c',
    playhead: '#ff2d3c',
    ghost: '#f2f2f2',
    glyph: '#ffe3e3',
  },
  blues: {
    ...DARK_THEME,
    background: '#0b1224',
    backgroundTop: '#070c18',
    backgroundBottom: '#13275a',
    textDim: '#93a3c4',
    stringActive: '#8fd0ff',
    dot: '#38a6ff',
    dotText: '#04121f',
    laneBg: '#0f1a33',
    laneLine: '#2c3f68',
    noteBox: '#1a2a4d',
    noteBoxActive: '#38a6ff',
    playhead: '#38a6ff',
    ghost: '#f2f2f2',
    glyph: '#e3f0ff',
  },
  lofi: {
    ...DARK_THEME,
    background: '#1c1529',
    backgroundTop: '#15101f',
    backgroundBottom: '#3a2440',
    textDim: '#b7a6c8',
    stringActive: '#ffc6de',
    dot: '#ff8fc2',
    dotText: '#2a0f1d',
    laneBg: '#241a31',
    laneLine: '#4a3a5c',
    noteBox: '#33264a',
    noteBoxActive: '#ff8fc2',
    playhead: '#ff8fc2',
    ghost: '#f2f2f2',
    glyph: '#fff0f7',
  },
  acoustic: {
    ...DARK_THEME,
    background: '#16110b',
    backgroundTop: '#100c08',
    backgroundBottom: '#33230f',
    textDim: '#b9a78f',
    stringActive: '#bff5d4',
    dot: '#6fe0a2',
    dotText: '#062112',
    laneBg: '#1f1810',
    laneLine: '#4a3b26',
    noteBox: '#2e2416',
    noteBoxActive: '#6fe0a2',
    playhead: '#6fe0a2',
    ghost: '#f2f2f2',
    glyph: '#fff6e6',
  },
};

export const THEME_NAMES: Record<ThemeId, string> = { dark: 'Classic dark', metal: 'Metal', blues: 'Blues', lofi: 'Lo-fi', acoustic: 'Acoustic' };

/** TikTok / Shorts UI overlays. Editable constants (CLAUDE.md §4, P17). */
export const SAFE_ZONES = {
  rightPx: 140,
  bottomPx: 420,
  topPx: 120,
};
