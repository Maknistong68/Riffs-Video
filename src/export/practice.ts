/** Make a practice link for a riff: its alphaTex (edits applied, in the worker) packed into a URL. */
import { encodePractice, MAX_LINK_CHARS, practiceUrl } from '../import/practiceLink';
import { styleOf, type RiffRecord } from '../storage/db';
import { riffConfig } from '../storage/riffConfig';
import { riffAlphaTex } from '../workers/client';

export async function makePracticeLink(riff: RiffRecord): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    const tex = await riffAlphaTex(riffConfig(riff, styleOf(riff)));
    const data = await encodePractice({ title: riff.title, artist: riff.artist, alphaTex: tex });
    if (data.length > MAX_LINK_CHARS) return { ok: false, message: 'This riff is too long for a link.' };
    return { ok: true, url: practiceUrl(data) };
  } catch {
    return { ok: false, message: 'Could not make a link for this riff.' };
  }
}

/** Copy to the clipboard; resolves with a message for the user. */
export async function copyText(text: string, done: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(text);
    return done;
  } catch {
    return 'Copy failed — select the text instead.';
  }
}
