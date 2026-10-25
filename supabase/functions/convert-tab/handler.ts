/**
 * HTTP layer of convert-tab: CORS, method/body checks, rate limiting, status codes.
 * Pure (no Deno APIs): index.ts wires it to Deno.serve; tests call it with plain Requests.
 */
import { parseRequest, type ConvertRequest, type ConvertResponse, type ErrorCode } from './contract.ts';
import type { RateLimiter } from './rateLimit.ts';

export type HandlerDeps = {
  convert: ((req: ConvertRequest) => Promise<ConvertResponse>) | null;
  limiter: RateLimiter;
  /** Allowed browser origins; '*' allows any. */
  allowedOrigins: string[];
  now: () => number;
};

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  too_long: 413,
  rate_limited: 429,
  not_a_tab: 422,
  model_refused: 422,
  model_failed: 502,
  not_configured: 503,
  server_error: 500,
};

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  const json = (body: ConvertResponse, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
  const failure = (code: ErrorCode, message: string, retryAfterSec?: number) =>
    json({ ok: false, error: { code, message, ...(retryAfterSec ? { retryAfterSec } : {}) } }, STATUS[code], retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : {});

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return failure('bad_request', 'Use POST.');
  if (!deps.convert) return failure('not_configured', 'AI import is not set up on the server yet.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failure('bad_request', 'Send JSON with "text" and "deviceId".');
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) return failure(parsed.code, parsed.message);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  const limit = deps.limiter.check({ device: parsed.value.deviceId, ip }, deps.now());
  if (!limit.ok) return failure('rate_limited', `Too many conversions. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.`, limit.retryAfterSec);

  try {
    const result = await deps.convert(parsed.value);
    if (result.ok) return json(result, 200);
    return failure(result.error.code, result.error.message, result.error.retryAfterSec);
  } catch {
    return failure('server_error', 'Something went wrong on the server. Try again.');
  }
}
