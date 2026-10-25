/**
 * One Claude call: user's tab text → alphaTex + per-note confidence (structured output).
 * Every failure becomes a ConvertFailure with a message the app can show as-is.
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateModelOutput, type ConvertRequest, type ConvertResponse } from './contract.ts';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, userMessage } from './prompt.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ClaudeOptions = { model: string; effort: Effort };

/** The slice of the SDK client this module uses (lets tests pass a fake). */
export type MessagesClient = Pick<Anthropic, 'beta'>;

export async function convertWithClaude(client: MessagesClient, req: ConvertRequest, opts: ClaudeOptions): Promise<ConvertResponse> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = client.beta.messages.stream({
      model: opts.model,
      max_tokens: 32_000,
      // Refusal fallback: if the safety classifiers decline, the API re-runs on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: opts.effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: userMessage(req.text, req.title) }],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return fail('not_configured', 'AI import is not set up correctly on the server.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      return fail('rate_limited', 'The AI service is busy. Try again in a minute.', 60);
    }
    if (e instanceof Anthropic.APIError) return fail('model_failed', 'The AI service had a problem. Try again.');
    return fail('model_failed', 'Could not reach the AI service. Try again.');
  }

  if (message.stop_reason === 'refusal') {
    return fail('model_refused', 'The AI declined to convert this text. Try the Paste text tab option instead.');
  }
  if (message.stop_reason === 'max_tokens') {
    return fail('model_failed', 'That tab is too long to convert in one go. Paste one section (a riff or a verse) at a time.');
  }
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('model_failed', 'The AI answer was not readable. Try again.');
  }
  const out = validateModelOutput(json);
  if (!out.ok) return fail('model_failed', `The AI answer was incomplete (${out.reason}). Try again.`);
  if (out.value.notATab || !out.value.alphaTex.trim()) {
    return fail('not_a_tab', 'No guitar tab found in that text. Paste the tab itself (lines like e|--0--3--|).');
  }
  return {
    ok: true,
    title: out.value.title,
    alphaTex: out.value.alphaTex,
    notes: out.value.notes,
    rhythmGuessed: out.value.rhythmGuessed,
    tempoGuessed: out.value.tempoGuessed,
    warnings: out.value.warnings,
    model: message.model,
  };
}

function fail(code: Extract<ConvertResponse, { ok: false }>['error']['code'], message: string, retryAfterSec?: number): ConvertResponse {
  return { ok: false, error: { code, message, ...(retryAfterSec ? { retryAfterSec } : {}) } };
}
