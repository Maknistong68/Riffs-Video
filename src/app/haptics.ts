export function haptic(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
