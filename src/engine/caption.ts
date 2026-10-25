/**
 * Auto title / caption / hashtags for posting (phase 6). Pure: derived from the riff, its timeline
 * and its style, so the same export always suggests the same text.
 */
import { tuningLabel } from './tuning';
import type { Timeline } from './timeline';

export type CaptionInput = {
  title: string;
  artist?: string;
  credit?: string;
  timeline: Pick<Timeline, 'tuning' | 'capo' | 'tempoMap' | 'events'>;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  genre?: 'metal' | 'blues' | 'lofi' | 'acoustic' | 'dark';
  isOriginal: boolean;
  teach?: { slowMo?: boolean; loopHardest?: boolean; positions?: boolean; hookFirst?: boolean; speedUp?: boolean };
  part?: { part: number; parts: number };
  practiceUrl?: string;
  /** "RIFF #12": goes in front of the title and the caption. */
  series?: string;
};

export type Caption = { title: string; caption: string; hashtags: string[]; full: string };

const MAX_TAGS = 8;

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase()
    .slice(0, 24);

export function buildCaption(i: CaptionInput): Caption {
  const t = i.timeline;
  const bpm = Math.round(t.tempoMap[0]?.bpm ?? 0);
  const tuning = tuningLabel(t.tuning, t.capo);
  const techs = new Set(t.events.flatMap((e) => e.tech));
  const teaching = !!(i.teach?.slowMo || i.teach?.loopHardest || i.teach?.positions);
  const part = i.part && i.part.parts > 1 ? ` (Part ${i.part.part}/${i.part.parts})` : '';

  const pre = i.series ? `${i.series} · ` : '';
  const title = `${pre}${i.title}${i.artist ? ` – ${i.artist}` : ''} ${teaching ? 'guitar lesson' : 'guitar riff'}${part}`;
  const bits = [
    teaching ? 'Tab + slow-mo walkthrough' : 'Tab on screen',
    tuning,
    bpm ? `${bpm} bpm` : '',
    i.difficulty ? `${i.difficulty} level` : '',
    i.teach?.positions ? 'shown in 3 positions' : '',
    i.teach?.speedUp ? 'sped up to 150%' : '',
  ].filter(Boolean);
  const caption = `${pre}${i.title}${i.artist ? ` by ${i.artist}` : ''} 🎸 ${bits.join(' · ')}${part}${i.credit ? `\n${i.credit}` : ''}${i.isOriginal ? '\nOriginal riff — free to use with credit.' : ''}${i.practiceUrl ? `\nPractice it slowly: ${i.practiceUrl}` : ''}\nWhat BPM can you play it at? 👇`;

  const tags: string[] = ['#guitar', '#guitartok', teaching ? '#guitarlesson' : '#guitarriff', '#guitartabs'];
  const titleTag = slug(i.title);
  if (titleTag.length >= 3) tags.push(`#${titleTag}`);
  if (i.artist && slug(i.artist).length >= 3) tags.push(`#${slug(i.artist)}`);
  const genreTag = { metal: '#metalguitar', blues: '#bluesguitar', lofi: '#lofiguitar', acoustic: '#acousticguitar', dark: '' }[i.genre ?? 'dark'];
  if (genreTag) tags.push(genreTag);
  if (/drop/i.test(tuning)) tags.push(`#${slug(tuning)}`);
  if (i.difficulty === 'Easy') tags.push('#beginnerguitar');
  if (techs.has('bend')) tags.push('#bends');
  if (techs.has('palmMute')) tags.push('#palmmute');
  if (i.isOriginal) tags.push('#originalriff');
  const hashtags = [...new Set(tags)].slice(0, MAX_TAGS);
  return { title, caption, hashtags, full: `${caption}\n\n${hashtags.join(' ')}` };
}
