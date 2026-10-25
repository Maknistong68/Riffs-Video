/** SoundFont registry (P22). Files are precached by the service worker for offline use. */
import sonivoxUrl from '@coderline/alphatab/soundfont/sonivox.sf2?url';
import guitarsUrl from '../assets/soundfonts/riffreel-guitars.sf3?url';

export type SoundPack = { id: string; name: string; url: string; licence: string };

export const SOUND_PACKS: SoundPack[] = [
  // Real multi-sampled guitars (nylon, steel, jazz, clean, bass + drum kit for the click), cut from
  // FluidR3Mono GM with scripts/subset-soundfont.mjs, then scripts/trim-soundfont-attacks.py (the
  // originals start up to 57 ms before the pluck, which would make every note late): 1.5 MB, precached.
  { id: 'fluid-guitars', name: 'Studio guitars (FluidR3)', url: guitarsUrl, licence: 'MIT, © Frank Wen, Michael Cowgill' },
  { id: 'sonivox', name: 'Sonivox GM (classic)', url: sonivoxUrl, licence: 'Apache-2.0, © Sonic Network Inc.' },
];

export const DEFAULT_SOUND_PACK = SOUND_PACKS[0]!;

const cache = new Map<string, Promise<Uint8Array>>();

export function fetchSoundFont(url: string): Promise<Uint8Array> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Sound pack download failed (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
