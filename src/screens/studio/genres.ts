/** One-tap genre looks (phase 6): colour theme + guitar tone + drum groove that belong together. */
import type { DrumPattern } from '../../audio/drums';
import type { ThemeId } from '../../render/theme';

export type Genre = { id: string; name: string; theme: ThemeId; tone: string; drums: DrumPattern };

export const GENRES: Genre[] = [
  { id: 'rock', name: 'Rock', theme: 'dark', tone: 'rock', drums: 'rock' },
  { id: 'metal', name: 'Metal', theme: 'metal', tone: 'metal', drums: 'metal' },
  { id: 'blues', name: 'Blues', theme: 'blues', tone: 'crunch', drums: 'blues' },
  { id: 'funk', name: 'Funk', theme: 'dark', tone: 'clean', drums: 'funk' },
  { id: 'lofi', name: 'Lo-fi', theme: 'lofi', tone: 'lofi', drums: 'lofi' },
  { id: 'acoustic', name: 'Acoustic', theme: 'acoustic', tone: 'acoustic', drums: 'folk' },
];
