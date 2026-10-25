/** Carries text from one screen into the Paste text tab or AI import screen (one-shot). */
type Target = 'paste' | 'ai';
const pending: Record<Target, string | null> = { paste: null, ai: null };

export function handOffToPaste(text: string): void {
  pending.paste = text;
}

export function handOffToAi(text: string): void {
  pending.ai = text;
}

function take(target: Target): string {
  const t = pending[target] ?? '';
  pending[target] = null;
  return t;
}

export const takePastedText = (): string => take('paste');
export const takeAiText = (): string => take('ai');
