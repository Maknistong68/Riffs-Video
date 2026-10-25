/**
 * Supabase Edge Function `convert-tab` (CLAUDE.md §6): pasted tab text → alphaTex via Claude.
 * The Anthropic API key lives only here, as the ANTHROPIC_API_KEY secret.
 *
 *   supabase secrets set ANTHROPIC_API_KEY=... [ALLOWED_ORIGINS=https://your.app] [CLAUDE_MODEL=...] [CLAUDE_EFFORT=medium]
 *   supabase functions deploy convert-tab
 */
import Anthropic from '@anthropic-ai/sdk';
import { convertWithClaude, DEFAULT_MODEL, type Effort } from './claude.ts';
import { handleRequest } from './handler.ts';
import { DEFAULT_LIMITS, RateLimiter } from './rateLimit.ts';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void };

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 140_000 }) : null;
const model = Deno.env.get('CLAUDE_MODEL') || DEFAULT_MODEL;
const effort = (Deno.env.get('CLAUDE_EFFORT') || 'medium') as Effort;
const limiter = new RateLimiter(DEFAULT_LIMITS);
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '*').split(',').map((s) => s.trim()).filter(Boolean);

Deno.serve((req) =>
  handleRequest(req, {
    convert: client ? (r) => convertWithClaude(client, r, { model, effort }) : null,
    limiter,
    allowedOrigins,
    now: () => Date.now(),
  }),
);
