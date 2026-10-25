/**
 * Wire contract of the convert-tab Edge Function (request from the app, JSON response).
 * The app validates responses independently (src/import/ai.ts); this file validates the model.
 */

export const MAX_TEXT_CHARS = 20_000;
export const MAX_ALPHATEX_CHARS = 120_000;
export const MAX_NOTES = 4000;

import { GEN_DIFFICULTIES, GEN_GENRES, type GenerateBrief } from './prompt.ts';

export const MAX_IDEA_CHARS = 500;

/** mode 'generate' (phase 6): no user tab — the model writes an original riff from the brief. */
export type ConvertRequest = { text: string; deviceId: string; title?: string; mode?: 'convert' | 'generate'; brief?: GenerateBrief };

export type ModelNote = { bar: number; beat: number; string: number; fret: number; confidence: number };

export type ModelOutput = {
  title: string;
  notATab: boolean;
  alphaTex: string;
  rhythmGuessed: boolean;
  tempoGuessed: boolean;
  notes: ModelNote[];
  warnings: string[];
};

export type ErrorCode =
  | 'bad_request'
  | 'too_long'
  | 'rate_limited'
  | 'not_a_tab'
  | 'model_refused'
  | 'model_failed'
  | 'not_configured'
  | 'server_error';

export type ConvertSuccess = {
  ok: true;
  title: string;
  alphaTex: string;
  notes: ModelNote[];
  rhythmGuessed: boolean;
  tempoGuessed: boolean;
  warnings: string[];
  model: string;
};
export type ConvertFailure = { ok: false; error: { code: ErrorCode; message: string; retryAfterSec?: number } };
export type ConvertResponse = ConvertSuccess | ConvertFailure;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Request body → typed request, or a user-facing reason it is not acceptable. */
export function parseRequest(body: unknown): { ok: true; value: ConvertRequest } | { ok: false; code: 'bad_request' | 'too_long'; message: string } {
  if (!isObj(body)) return { ok: false, code: 'bad_request', message: 'Send JSON with "text" and "deviceId".' };
  const { text, deviceId, title } = body;
  if (body.mode === 'generate') {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) return { ok: false, code: 'bad_request', message: 'Missing device id.' };
    const b = body.brief;
    if (!isObj(b) || !GEN_GENRES.includes(b.genre as never) || !GEN_DIFFICULTIES.includes(b.difficulty as never) || !isInt(b.bars) || b.bars < 1 || b.bars > 8) {
      return { ok: false, code: 'bad_request', message: 'Pick a genre, a difficulty and 1–8 bars.' };
    }
    if (b.idea !== undefined && typeof b.idea !== 'string') return { ok: false, code: 'bad_request', message: 'The idea must be text.' };
    if (typeof b.idea === 'string' && b.idea.length > MAX_IDEA_CHARS) return { ok: false, code: 'too_long', message: `Keep the idea under ${MAX_IDEA_CHARS} characters.` };
    const idea = typeof b.idea === 'string' && b.idea.trim() ? b.idea.trim() : undefined;
    const brief = { genre: b.genre, difficulty: b.difficulty, bars: b.bars, ...(idea ? { idea } : {}) } as GenerateBrief;
    return { ok: true, value: { text: '', deviceId, mode: 'generate', brief } };
  }
  if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'bad_request', message: 'Paste some tab text first.' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, code: 'too_long', message: `That text is too long (max ${MAX_TEXT_CHARS.toLocaleString('en')} characters). Paste just the riff.` };
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) return { ok: false, code: 'bad_request', message: 'Missing device id.' };
  if (title !== undefined && typeof title !== 'string') return { ok: false, code: 'bad_request', message: 'Title must be text.' };
  return { ok: true, value: { text, deviceId, ...(title ? { title: title.slice(0, 200) } : {}) } };
}

/**
 * The model's JSON → ModelOutput. Structured outputs make the shape very likely, but the
 * server still checks it (and bounds sizes) so a broken answer becomes a clear error.
 */
export function validateModelOutput(v: unknown): { ok: true; value: ModelOutput } | { ok: false; reason: string } {
  if (!isObj(v)) return { ok: false, reason: 'answer is not a JSON object' };
  const { title, notATab, alphaTex, rhythmGuessed, tempoGuessed, notes, warnings } = v;
  if (typeof alphaTex !== 'string') return { ok: false, reason: 'alphaTex missing' };
  if (alphaTex.length > MAX_ALPHATEX_CHARS) return { ok: false, reason: 'alphaTex too long' };
  if (typeof notATab !== 'boolean' || typeof rhythmGuessed !== 'boolean' || typeof tempoGuessed !== 'boolean') return { ok: false, reason: 'flags missing' };
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) return { ok: false, reason: 'notes list missing or too long' };
  const clean: ModelNote[] = [];
  for (const n of notes) {
    if (!isObj(n) || !isInt(n.bar) || !isInt(n.beat) || !isInt(n.string) || !isInt(n.fret) || typeof n.confidence !== 'number' || !Number.isFinite(n.confidence)) {
      return { ok: false, reason: 'a note entry is malformed' };
    }
    clean.push({ bar: n.bar, beat: n.beat, string: n.string, fret: n.fret, confidence: Math.max(0, Math.min(1, n.confidence)) });
  }
  const warn = Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 300)).slice(0, 20) : [];
  return {
    ok: true,
    value: { title: typeof title === 'string' ? title.slice(0, 200) : '', notATab, alphaTex, rhythmGuessed, tempoGuessed, notes: clean, warnings: warn },
  };
}
