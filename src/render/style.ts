import type { SkinId } from './skins';

export type LayoutId = 'classic' | 'overlay' | 'split' | 'closeup';
export type DifficultyBadge = 'none' | 'Easy' | 'Medium' | 'Hard';

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
};

export const DEFAULT_STYLE: RenderStyle = {
  layout: 'classic',
  skin: 'strat',
  leftHanded: false,
  fingerNumbers: false,
  pickArrows: true,
  noteNames: false,
  lookAhead: true,
  credit: '',
  difficulty: 'none',
};

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'overlay', name: 'Neck-Overlay' },
  { id: 'split', name: 'Split' },
  { id: 'closeup', name: 'Close-up' },
];
