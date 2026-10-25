/**
 * AI import client (phase 4): sends the user's pasted tab text to the `convert-tab` Supabase Edge
 * Function, which holds the Claude API key. Nothing here throws: every outcome, including a
 * malformed answer, comes back as an AiResult the UI can show. The answer is then re-checked in
 * the worker (import/aiRiff.ts) — the app never trusts the model's alphaTex unchecked.
 */
import type { AiNote } from './aiRiff';

export const MAX_AI_TEXT_CHARS = 20_000;
const MAX_ALPHATEX_CHARS = 120_000;
const TIMEOUT_MS = 150_000;

export type AiConfig = { url: string; anonKey: string };

export type AiSuccess = {
  ok: true;
  title: string;
  alphaTex: string;
  notes: AiNote[];
  rhythmGuessed: boolean;
  tempoGuessed: boolean;
  warnings: string[];
  model: string;
};

export type AiErrorCode =
  | 'offline'
  | 'network'
  | 'timeout'
  | 'not_configured'
  | 'bad_request'
  | 'too_long'
  | 'rate_limited'
  | 'not_a_tab'
  | 'model_refused'
  | 'model_failed'
  | 'server_error'
  | 'bad_response';

export type AiFailure = { ok: false; code: AiErrorCode; message: string; retryAfterSec?: number };
export type AiResult = AiSuccess | AiFailure;

/**
 * Failures that come from the model's answer (or a broken answer) go to Riff Review with their
 * message; the rest are about getting there (connection, limits, input) and stay on the form.
 */
export function isAnswerFailure(code: AiErrorCode): boolean {
  return code === 'not_a_tab' || code === 'model_refused' || code === 'model_failed' || code === 'bad_response';
}

/** From the build env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public by design), or a full VITE_CONVERT_TAB_URL. */
export function aiConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): AiConfig | null {
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
  const url = env.VITE_CONVERT_TAB_URL || (env.VITE_SUPABASE_URL ? `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/convert-tab` : '');
  return url && anonKey ? { url, anonKey } : null;
}

const fail = (code: AiErrorCode, message: string, retryAfterSec?: number): AiFailure => ({ ok: false, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const CODES: AiErrorCode[] = ['bad_request', 'too_long', 'rate_limited', 'not_a_tab', 'model_refused', 'model_failed', 'not_configured', 'server_error'];

/** Strictly validate whatever the server sent back. Pure. */
export function parseConvertResponse(status: number, bodyText: string, retryAfterHeader: string | null = null): AiResult {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    if (status === 429) return fail('rate_limited', 'Too many conversions right now. Try again in a few minutes.', Number(retryAfterHeader) || undefined);
    return fail('bad_response', status >= 500 ? 'The AI service is having trouble. Try again later.' : 'The AI service sent an unreadable answer.');
  }
  if (!isObj(body)) return fail('bad_response', 'The AI service sent an unreadable answer.');

  if (body.ok !== true) {
    const err = isObj(body.error) ? body.error : {};
    const known = CODES.includes(err.code as AiErrorCode);
    const code = known ? (err.code as AiErrorCode) : status === 429 ? 'rate_limited' : 'server_error';
    const message = known && typeof err.message === 'string' && err.message.trim() ? err.message.slice(0, 300) : 'AI import failed. Try again.';
    const retry = typeof err.retryAfterSec === 'number' ? err.retryAfterSec : Number(retryAfterHeader) || undefined;
    return fail(code, message, retry);
  }

  const { alphaTex, title, notes, rhythmGuessed, tempoGuessed, warnings, model } = body;
  if (typeof alphaTex !== 'string' || !alphaTex.trim()) return fail('bad_response', 'The AI answer had no tab in it.');
  if (alphaTex.length > MAX_ALPHATEX_CHARS) return fail('bad_response', 'The AI answer was too long to use.');
  const cleanNotes: AiNote[] = [];
  const extraWarnings: string[] = [];
  if (Array.isArray(notes)) {
    for (const n of notes.slice(0, 4000)) {
      if (isObj(n) && isInt(n.bar) && isInt(n.beat) && isInt(n.string) && isInt(n.fret) && typeof n.confidence === 'number' && Number.isFinite(n.confidence)) {
        cleanNotes.push({ bar: n.bar, beat: n.beat, string: n.string, fret: n.fret, confidence: Math.max(0, Math.min(1, n.confidence)) });
      }
    }
    if (cleanNotes.length < notes.length) extraWarnings.push('Some note confidences from the AI were unreadable; those notes are marked unsure.');
  }
  return {
    ok: true,
    title: typeof title === 'string' ? title.slice(0, 200) : '',
    alphaTex,
    notes: cleanNotes,
    rhythmGuessed: rhythmGuessed !== false,
    tempoGuessed: tempoGuessed !== false,
    warnings: [...(Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 300)).slice(0, 20) : []), ...extraWarnings],
    model: typeof model === 'string' ? model.slice(0, 80) : '',
  };
}

export type ConvertDeps = {
  config: AiConfig | null;
  deviceId: string;
  fetchFn?: typeof fetch;
  online?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Call the Edge Function. Resolves with an AiResult for every outcome; never rejects. */
export async function convertTabWithAI(input: { text: string; title?: string }, deps: ConvertDeps): Promise<AiResult> {
  if (!deps.config) return fail('not_configured', 'AI import isn’t set up in this version of the app. Use Paste text tab instead.');
  const text = input.text;
  if (!text.trim()) return fail('bad_request', 'Paste some tab text first.');
  if (text.length > MAX_AI_TEXT_CHARS) return fail('too_long', `That text is too long (max ${MAX_AI_TEXT_CHARS.toLocaleString('en')} characters). Paste just the riff.`);
  if (deps.online === false) return fail('offline', 'AI import needs an internet connection. Paste text tab works offline.');

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  deps.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await (deps.fetchFn ?? fetch)(deps.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.config.anonKey}`, apikey: deps.config.anonKey },
      body: JSON.stringify({ text, deviceId: deps.deviceId, ...(input.title?.trim() ? { title: input.title.trim() } : {}) }),
      signal: ctrl.signal,
    });
    const bodyText = await res.text();
    return parseConvertResponse(res.status, bodyText, res.headers.get('retry-after'));
  } catch {
    if (timedOut) return fail('timeout', 'The AI took too long. Try a shorter piece of tab.');
    if (deps.signal?.aborted) return fail('network', 'Cancelled.');
    return fail('network', 'Could not reach the AI service. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onAbort);
  }
}
