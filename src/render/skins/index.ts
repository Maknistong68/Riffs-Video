/** Guitar skins: colours, inlays, binding and string gauges. Pure data. */

export type SkinId = 'strat' | 'lespaul' | 'acoustic' | 'classical' | 'bass4' | 'seven';

export type Skin = {
  id: SkinId;
  name: string;
  wood: string;
  woodGrain: string;
  binding: string | null;
  fretWire: string;
  nut: string;
  inlay: string;
  inlayShape: 'dot' | 'block' | 'trapezoid' | 'none';
  /** Plain (unwound) string colour and wound string colour. */
  plain: string;
  wound: string;
  /** Strings counted from the highest pitch; strings at index ≥ this are wound. */
  firstWound: (strings: number) => number;
  /** Line width of string i (0 = highest) of n. */
  gauge: (i: number, n: number) => number;
  /** Neck height multiplier (classical necks are wider). */
  neckScale: number;
  /** Suggested tuning when the skin is picked for a new riff (display only). */
  strings: number;
};

const linear = (thin: number, thick: number) => (i: number, n: number) => thin + ((thick - thin) * i) / Math.max(1, n - 1);

export const SKINS: Record<SkinId, Skin> = {
  strat: {
    id: 'strat', name: 'Strat (rosewood)', wood: '#2e1c13', woodGrain: '#3d261a', binding: null,
    fretWire: '#d8dbe0', nut: '#f4ecd6', inlay: '#efe6d2', inlayShape: 'dot',
    plain: '#c9c4b8', wound: '#a9a397', firstWound: () => 3, gauge: linear(2, 6), neckScale: 1, strings: 6,
  },
  lespaul: {
    id: 'lespaul', name: 'Les Paul', wood: '#2b1a10', woodGrain: '#3a2416', binding: '#efe3c2',
    fretWire: '#cfd2d7', nut: '#f1e7cc', inlay: '#e9e1cf', inlayShape: 'trapezoid',
    plain: '#c9c4b8', wound: '#aaa396', firstWound: () => 3, gauge: linear(2.2, 6.5), neckScale: 1.05, strings: 6,
  },
  acoustic: {
    id: 'acoustic', name: 'Acoustic', wood: '#3b2414', woodGrain: '#4a2e1a', binding: '#e8dcc0',
    fretWire: '#cfc7b4', nut: '#efe6cf', inlay: '#e8e2d0', inlayShape: 'dot',
    plain: '#d9c9a3', wound: '#c49a5c', firstWound: () => 2, gauge: linear(2.4, 7), neckScale: 1.05, strings: 6,
  },
  classical: {
    id: 'classical', name: 'Classical', wood: '#21140c', woodGrain: '#2c1b10', binding: null,
    fretWire: '#c8c2b0', nut: '#efe8d6', inlay: '#000000', inlayShape: 'none',
    plain: '#f2efe6', wound: '#c7c9cf', firstWound: () => 3, gauge: linear(3, 6), neckScale: 1.18, strings: 6,
  },
  bass4: {
    id: 'bass4', name: '4-string bass', wood: '#3b2414', woodGrain: '#4a2e1a', binding: null,
    fretWire: '#d0d3d8', nut: '#efe6cf', inlay: '#e8e2d0', inlayShape: 'dot',
    plain: '#b6b1a6', wound: '#a39d90', firstWound: () => 0, gauge: linear(5, 10), neckScale: 1.1, strings: 4,
  },
  seven: {
    id: 'seven', name: '7-string', wood: '#151210', woodGrain: '#1f1a16', binding: '#d8d8d8',
    fretWire: '#d6d9de', nut: '#e9e9e9', inlay: '#d9d9d9', inlayShape: 'block',
    plain: '#c9c4b8', wound: '#a9a397', firstWound: () => 3, gauge: linear(2, 7.5), neckScale: 1.08, strings: 7,
  },
};

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];
