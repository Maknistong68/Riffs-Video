/**
 * Practice links (phase 6): the riff itself travels in the URL — no server, no database.
 * Payload = deflate-raw(JSON {v, title, artist, alphaTex}) in base64url, after `#/p/`.
 * The receiving app re-parses the alphaTex like any other import.
 */

export type PracticePayload = { v: 1; title: string; artist: string; alphaTex: string };

/** Links longer than this are refused (some apps truncate long URLs). */
export const MAX_LINK_CHARS = 12_000;

const toB64Url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodePractice(p: Omit<PracticePayload, 'v'>): Promise<string> {
  const json = JSON.stringify({ v: 1, title: p.title.slice(0, 120), artist: p.artist.slice(0, 120), alphaTex: p.alphaTex });
  return toB64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

/** Never throws: a damaged or foreign link gives null. */
export async function decodePractice(data: string): Promise<PracticePayload | null> {
  try {
    if (!/^[A-Za-z0-9_-]{8,}$/.test(data) || data.length > MAX_LINK_CHARS) return null;
    const json = new TextDecoder().decode(await pipe(fromB64Url(data), new DecompressionStream('deflate-raw')));
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.v !== 1 || typeof o.alphaTex !== 'string' || !o.alphaTex.trim() || o.alphaTex.length > 200_000) return null;
    return { v: 1, title: typeof o.title === 'string' ? o.title : 'Riff', artist: typeof o.artist === 'string' ? o.artist : '', alphaTex: o.alphaTex };
  } catch {
    return null;
  }
}

export function practiceUrl(data: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/p/${data}`;
}
