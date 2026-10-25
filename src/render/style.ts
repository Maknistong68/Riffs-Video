import type { SkinId } from './skins';
import { DEFAULT_CAMERA, type Camera3D } from './camera';
import type { ThemeId } from './theme';

export type LayoutId = 'classic' | 'overlay' | 'split' | 'closeup';
export type DifficultyBadge = 'none' | 'auto' | 'Easy' | 'Medium' | 'Hard';

/** End-of-video card: none, "Follow for more", or "Part 1 of 3" (split videos). */
export type EndCard = { kind: 'none' | 'follow' | 'part'; text: string; part?: number; parts?: number };

/** Everything visual that the user can change. Part of FrameSettings → drawFrame stays pure. */
export type RenderStyle = {
  layout: LayoutId;
  skin: SkinId;
  leftHanded: boolean;
  /** Dots show the fretting finger (1–4, T) instead of the fret number. */
  fingerNumbers: boolean;
  pickArrows: boolean;
  noteNames: boolean;
  /** Ghost rings where the next notes will be (P10). */
  lookAhead: boolean;
  credit: string;
  difficulty: DifficultyBadge;
  /** Flat fretboard or a 3D guitar neck seen from `camera`. */
  view: '2d' | '3d';
  camera: Camera3D;
  /** Colour theme (genre look). */
  theme: ThemeId;
  /** "Bar 3 / 8" above the progress bar. */
  barCounter: boolean;
  /** End-of-video fretboard heatmap. */
  heatmap: boolean;
  /** "Guess the song?" opener (title hidden until the reveal at the end). */
  opener: 'none' | 'guess';
  endCard: EndCard;
  /** Big line at the top from the first frame ("Can you play this?"); empty = title only. */
  hook: string;
  /** Series badge ("RIFF #12") so a run of videos reads as one show. */
  series: SeriesBadge;
};

export type SeriesBadge = { on: boolean; label: string; number: number };

export const DEFAULT_STYLE: RenderStyle = {
  layout: 'classic',
  skin: 'strat',
  leftHanded: false,
  fingerNumbers: false,
  pickArrows: true,
  noteNames: false,
  lookAhead: true,
  credit: '',
  difficulty: 'auto',
  view: '3d',
  camera: DEFAULT_CAMERA,
  theme: 'dark',
  barCounter: true,
  heatmap: false,
  opener: 'none',
  endCard: { kind: 'none', text: '' },
  hook: 'Can you play this?',
  series: { on: false, label: 'Riff', number: 1 },
};

/** "RIFF #12" (empty when off). */
export function seriesText(s: SeriesBadge): string {
  return s.on ? `${s.label.trim() || 'Riff'} #${Math.max(1, Math.round(s.number))}`.toUpperCase() : '';
}

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'overlay', name: 'Neck-Overlay' },
  { id: 'split', name: 'Split' },
  { id: 'closeup', name: 'Close-up' },
];
