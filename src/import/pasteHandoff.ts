/** Carries text from another screen into the Paste text tab screen (one-shot). */
let pending: string | null = null;

export function handOffToPaste(text: string): void {
  pending = text;
}

export function takePastedText(): string {
  const t = pending ?? '';
  pending = null;
  return t;
}
