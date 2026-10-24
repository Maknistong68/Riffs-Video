/** SoundFont registry (P22). Files are precached by the service worker for offline use. */
import sonivoxUrl from '@coderline/alphatab/soundfont/sonivox.sf2?url';

export type SoundPack = { id: string; name: string; url: string; licence: string };

export const SOUND_PACKS: SoundPack[] = [
  { id: 'sonivox', name: 'Sonivox GM (built-in)', url: sonivoxUrl, licence: 'Apache-2.0, © Sonic Network Inc.' },
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
