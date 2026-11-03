import { useSyncExternalStore } from 'react';
import { pwaUpdates } from './pwa';

export function PwaUpdatePrompt() {
  const state = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot);
  if (!state.visible) return null;
  return (
    <section
      className="pwa-update"
      data-pwa-ui
      role="status"
      aria-label="App update"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          pwaUpdates.dismiss();
        }
      }}
    >
      <span>{state.error || 'A new version of GitStream is ready.'}</span>
      <button type="button" disabled={state.applying} onClick={() => void pwaUpdates.apply()}>
        {state.applying ? 'Updating…' : 'Update app'}
      </button>
      <button
        type="button"
        disabled={state.applying}
        aria-label="Dismiss app update"
        onClick={pwaUpdates.dismiss}
      >
        Later
      </button>
    </section>
  );
}
