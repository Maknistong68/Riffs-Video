import { describe, expect, it } from 'vitest';
import { aiConfig, convertTabWithAI, generateRiffWithAI, isAnswerFailure, parseConvertResponse, type AiResult } from '../../src/import/ai';
import { handleRequest } from '../../supabase/functions/convert-tab/handler';
import { DEFAULT_LIMITS, RateLimiter } from '../../supabase/functions/convert-tab/rateLimit';

const CONFIG = { url: 'https://p.supabase.co/functions/v1/convert-tab', anonKey: 'anon' };
const OK_BODY = {
  ok: true,
  title: 'Riff',
  alphaTex: '\\title "Riff"\n:8 0.6',
  notes: [{ bar: 0, beat: 0, string: 6, fret: 0, confidence: 0.9 }],
  rhythmGuessed: true,
  tempoGuessed: false,
  warnings: [],
  model: 'claude-opus-5-5',
};

const respond = (status: number, body: string, headers: Record<string, string> = {}): typeof fetch =>
  (async () => new Response(body, { status, headers })) as typeof fetch;

describe('aiConfig', () => {
  it('needs a URL and the public anon key', () => {
    expect(aiConfig({})).toBeNull();
    expect(aiConfig({ VITE_SUPABASE_URL: 'https://p.supabase.co/' })).toBeNull();
    expect(aiConfig({ VITE_SUPABASE_URL: 'https://p.supabase.co/', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({ url: 'https://p.supabase.co/functions/v1/convert-tab', anonKey: 'k' });
  });
});

describe('parseConvertResponse: malformed answers become clear failures', () => {
  const cases: [string, number, string, AiResult['ok'], string?][] = [
    ['valid', 200, JSON.stringify(OK_BODY), true],
    ['HTML error page', 502, '<html>Bad gateway</html>', false, 'bad_response'],
    ['empty body', 200, '', false, 'bad_response'],
    ['JSON array', 200, '[1,2]', false, 'bad_response'],
    ['ok without alphaTex', 200, JSON.stringify({ ...OK_BODY, alphaTex: undefined }), false, 'bad_response'],
    ['ok with blank alphaTex', 200, JSON.stringify({ ...OK_BODY, alphaTex: '   ' }), false, 'bad_response'],
    ['ok with number alphaTex', 200, JSON.stringify({ ...OK_BODY, alphaTex: 42 }), false, 'bad_response'],
    ['huge alphaTex', 200, JSON.stringify({ ...OK_BODY, alphaTex: 'x'.repeat(200_000) }), false, 'bad_response'],
    ['server error object', 422, JSON.stringify({ ok: false, error: { code: 'not_a_tab', message: 'No guitar tab found.' } }), false, 'not_a_tab'],
    ['unknown error code', 500, JSON.stringify({ ok: false, error: { code: 'weird', message: 'x' } }), false, 'server_error'],
    ['429 plain text', 429, 'slow down', false, 'rate_limited'],
  ];
  for (const [name, status, body, ok, code] of cases) {
    it(name, () => {
      const r = parseConvertResponse(status, body, '30');
      expect(r.ok).toBe(ok);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.message.length).toBeGreaterThan(5);
      }
    });
  }
  it('keeps a usable alphaTex even when note confidences are broken (and says so)', () => {
    const r = parseConvertResponse(200, JSON.stringify({ ...OK_BODY, notes: [{ bar: 'x' }, ...OK_BODY.notes], warnings: 'nope' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notes).toHaveLength(1);
      expect(r.warnings.join(' ')).toMatch(/unreadable/);
    }
  });
});

describe('convertTabWithAI', () => {
  const deps = { config: CONFIG, deviceId: 'device-1234' };
  it('never calls out without config, text or connection', async () => {
    let called = false;
    const spy = (async () => ((called = true), new Response('{}'))) as typeof fetch;
    expect(await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, config: null, fetchFn: spy })).toMatchObject({ ok: false, code: 'not_configured' });
    expect(await convertTabWithAI({ text: '  ' }, { ...deps, fetchFn: spy })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await convertTabWithAI({ text: 'x'.repeat(20_001) }, { ...deps, fetchFn: spy })).toMatchObject({ ok: false, code: 'too_long' });
    expect(await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, online: false, fetchFn: spy })).toMatchObject({ ok: false, code: 'offline' });
    expect(called).toBe(false);
  });
  it('sends text + device id with the anon key and returns the answer', async () => {
    let sent: RequestInit | undefined;
    const f = (async (_u: string, init?: RequestInit) => ((sent = init), new Response(JSON.stringify(OK_BODY), { status: 200 }))) as typeof fetch;
    const r = await convertTabWithAI({ text: 'e|-0-|', title: 'My riff' }, { ...deps, fetchFn: f });
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(sent!.body))).toEqual({ text: 'e|-0-|', deviceId: 'device-1234', title: 'My riff' });
    expect((sent!.headers as Record<string, string>).Authorization).toBe('Bearer anon');
  });
  it('network failure and timeout resolve with a message', async () => {
    const boom = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    expect(await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, fetchFn: boom })).toMatchObject({ ok: false, code: 'network' });
    const hang = ((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    expect(await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, fetchFn: hang, timeoutMs: 20 })).toMatchObject({ ok: false, code: 'timeout' });
  });
  it('rate limit carries the wait time', async () => {
    const r = await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, fetchFn: respond(429, JSON.stringify({ ok: false, error: { code: 'rate_limited', message: 'Too many.', retryAfterSec: 120 } }), { 'retry-after': '120' }) });
    expect(r).toMatchObject({ ok: false, code: 'rate_limited', retryAfterSec: 120 });
  });
  it('round-trips through the real Edge Function handler', async () => {
    const fn = (async (url: string, init?: RequestInit) =>
      handleRequest(new Request(url, init), {
        convert: async () => ({ ...OK_BODY, ok: true }),
        limiter: new RateLimiter(DEFAULT_LIMITS),
        allowedOrigins: ['*'],
        now: () => 0,
      })) as typeof fetch;
    const r = await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, fetchFn: fn });
    expect(r).toMatchObject({ ok: true, alphaTex: OK_BODY.alphaTex, notes: OK_BODY.notes });
    const bad = await convertTabWithAI({ text: 'e|-0-|' }, { ...deps, fetchFn: (async (url: string, init?: RequestInit) => handleRequest(new Request(url, init), { convert: null, limiter: new RateLimiter(DEFAULT_LIMITS), allowedOrigins: ['*'], now: () => 0 })) as typeof fetch });
    expect(bad).toMatchObject({ ok: false, code: 'not_configured' });
  });
  it('answer failures go to Riff Review, transport failures stay on the form', () => {
    expect(['not_a_tab', 'model_refused', 'model_failed', 'bad_response'].every((c) => isAnswerFailure(c as never))).toBe(true);
    expect(['offline', 'network', 'timeout', 'rate_limited', 'too_long', 'not_configured'].some((c) => isAnswerFailure(c as never))).toBe(false);
  });
});

describe('generateRiffWithAI', () => {
  const deps = { config: CONFIG, deviceId: 'device-1234' };
  it('stays offline-safe and bounded', async () => {
    let called = false;
    const spy = (async () => ((called = true), new Response('{}'))) as typeof fetch;
    const brief = { genre: 'rock' as const, difficulty: 'easy' as const, bars: 2 };
    expect(await generateRiffWithAI(brief, { ...deps, config: null, fetchFn: spy })).toMatchObject({ ok: false, code: 'not_configured' });
    expect(await generateRiffWithAI(brief, { ...deps, online: false, fetchFn: spy })).toMatchObject({ ok: false, code: 'offline' });
    expect(await generateRiffWithAI({ ...brief, idea: 'x'.repeat(501) }, { ...deps, fetchFn: spy })).toMatchObject({ ok: false, code: 'too_long' });
    expect(called).toBe(false);
  });
  it('sends the brief through the real handler, which passes it to the model as mode "generate"', async () => {
    let seen: unknown;
    const fn = (async (url: string, init?: RequestInit) =>
      handleRequest(new Request(url, init), {
        convert: async (req) => ((seen = req), { ...OK_BODY, ok: true }),
        limiter: new RateLimiter(DEFAULT_LIMITS),
        allowedOrigins: ['*'],
        now: () => 0,
      })) as typeof fetch;
    const r = await generateRiffWithAI({ genre: 'metal', difficulty: 'hard', bars: 4, idea: ' chuggy ' }, { ...deps, fetchFn: fn });
    expect(r).toMatchObject({ ok: true, alphaTex: OK_BODY.alphaTex });
    expect(seen).toEqual({ text: '', deviceId: 'device-1234', mode: 'generate', brief: { genre: 'metal', difficulty: 'hard', bars: 4, idea: 'chuggy' } });
  });
});
