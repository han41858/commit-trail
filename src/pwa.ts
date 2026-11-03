import { registerSW } from 'virtual:pwa-register';
import { PwaUpdates } from './PwaUpdates';

let registration: ServiceWorkerRegistration | undefined;
let activeChanged = false,
  started = false;
let activateWaiting: () => Promise<void> = async () => {};
const unknownWorker = {};
export const pwaUpdates = new PwaUpdates(
  async () => {
    if (activeChanged) pwaUpdates.controlled(registration?.active ?? unknownWorker);
    else await activateWaiting();
  },
  () => window.location.reload(),
);

export function registerPwa() {
  if (
    started ||
    !import.meta.env.PROD ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator)
  )
    return;
  started = true;
  activateWaiting = registerSW({
    onNeedRefresh: () => pwaUpdates.ready(registration?.waiting ?? unknownWorker),
    // Another tab's approval must not force this tab to reload while reading history.
    onNeedReload: () => {
      activeChanged = true;
      pwaUpdates.controlled(registration?.active ?? unknownWorker);
    },
    onRegisteredSW: (_url, value) => {
      registration = value;
      if (!value) return;
      if (value.waiting) pwaUpdates.ready(value.waiting);
      let lastCheck = Date.now();
      const check = () => {
        if (
          document.hidden ||
          !navigator.onLine ||
          value.installing ||
          Date.now() - lastCheck < 60000
        )
          return;
        lastCheck = Date.now();
        void value.update().catch(() => {
          /* Keep the installed shell on network/update failure. */
        });
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
    },
    onRegisterError: () => {
      /* PWA support is optional; ordinary web/API behavior stays available. */
    },
  });
}
