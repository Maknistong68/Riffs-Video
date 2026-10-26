import { registerSW } from 'virtual:pwa-register';
import { updatesHeld } from './updateHold';

/** How often an open app looks for a new deploy (it also looks each time it comes back to the front). */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Service worker with auto-update. An installed app on a phone is often only resumed, never
 * reloaded, so the browser's own update check rarely runs: check when the app comes back to the
 * front and every 30 min. A new version activates and reloads the page (registerType autoUpdate).
 */
export function registerPwa(): void {
  if (import.meta.env.DEV) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine && !updatesHeld()) void reg.update().catch(() => undefined);
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, CHECK_EVERY_MS);
    },
  });
}
