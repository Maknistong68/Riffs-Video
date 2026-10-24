import { registerSW } from 'virtual:pwa-register';

export function registerPwa(): void {
  if (import.meta.env.DEV) return;
  registerSW({ immediate: true });
}
